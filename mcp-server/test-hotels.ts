// Run with: npx tsx mcp-server/test-hotels.ts
// No API calls: live hotels are checked against the saved Google Hotels fixture, and the SerpApi path without a key.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { fakeLlm, type FakeTurn } from "../agent/fakeLlm";
import { runAgent } from "../agent/runAgent";
import { createServer } from "./createServer";
import { getAirport } from "./lib/data";
import { haversineMiles } from "./lib/geo";
import { findHotels, type HotelSearch } from "./lib/hotelProviders";
import { newRunContext } from "./lib/runContext";

// Weather comes from saved Open-Meteo fixtures, so presentTrips makes no network calls.
process.env.SMARTTRIP_WEATHER = "fixture";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

const SEARCH: HotelSearch = { destination: "SEA", checkIn: "2026-12-11", checkOut: "2026-12-15", travelers: 2, sort: "price" };

async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function main() {
  process.env.SMARTTRIP_CACHE_DIR = await mkdtemp(path.join(tmpdir(), "smarttrip-hotels-"));

  // ---- distance ----
  const hnl = (await getAirport("HNL"))!;
  const sea = (await getAirport("SEA"))!;
  const miles = haversineMiles(hnl, sea);
  check(`HNL to SEA is about 2,680 straight-line miles (${miles})`, miles > 2650 && miles < 2710);
  check("a point to itself is 0 miles", haversineMiles(sea, sea) === 0);

  // ---- the saved Google Hotels fixture ----
  process.env.HOTEL_PROVIDER = "fixture";
  const { source, results } = await findHotels(SEARCH, newRunContext());
  check("fixture hotels are labelled fixture", source === "fixture" && results.every((h) => h.source === "fixture"));
  check(`at most 8 results (${results.length})`, results.length > 0 && results.length <= 8);
  check(
    "every result has id, name, pricePerNight, and source",
    results.every((h) => h.id && h.name && typeof h.pricePerNight === "number" && h.source),
  );
  check("sorted by price, cheapest first", results.every((h, i) => i === 0 || results[i - 1].pricePerNight <= h.pricePerNight));
  check(
    "milesToAirport only where the hotel has coordinates, and computed from them",
    results.every((h) => (h.latitude === undefined) === (h.milesToAirport === undefined)) &&
      results.every((h) => h.milesToAirport === undefined || h.milesToAirport === haversineMiles({ latitude: h.latitude!, longitude: h.longitude! }, sea)),
  );
  check("live hotels never get a downtown distance", results.every((h) => h.milesToDowntown === undefined));
  check("listings with fewer than 10 reviews are left out", results.every((h) => (h.reviews ?? 0) >= 10));
  check("the stay total is nightly price times nights", results.every((h) => h.stayTotal === h.pricePerNight * 4 && h.nights === 4));
  check("the city comes from the airport file", results.every((h) => h.city === "Seattle"));
  check("ids look like h-xxxx-01", results.every((h, i) => new RegExp(`^h-[0-9a-f]{4}-0${i + 1}$`).test(h.id)), results.map((h) => h.id).join());
  const tiers = new Set(results.map((h) => h.tier).filter(Boolean));
  check("star classes become tiers", [...tiers].every((t) => ["budget", "mid", "upscale", "luxury"].includes(t!)) && tiers.size > 0);

  const capped = await findHotels({ ...SEARCH, maxPricePerNight: 70 }, newRunContext());
  check("a nightly cap is applied to fixture results too", capped.results.length > 0 && capped.results.every((h) => h.pricePerNight <= 70));
  check("a capped search gets its own ids", capped.results[0].id.slice(0, 6) !== results[0].id.slice(0, 6));
  const byRating = await findHotels({ ...SEARCH, sort: "rating" }, newRunContext());
  check(
    "sort: rating puts the best rated first",
    byRating.results.every((h, i) => i === 0 || (byRating.results[i - 1].rating ?? 0) >= (h.rating ?? 0)),
  );

  check(
    "a missing fixture says which ones exist",
    /No saved hotel fixture.*serpapi-hotels-SEA-2026-12-11-2026-12-15-2\.json/.test(await errorOf(findHotels({ ...SEARCH, travelers: 3 }, newRunContext()))),
  );

  // ---- live without a key ----
  process.env.HOTEL_PROVIDER = "serpapi";
  const savedKey = process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  check("HOTEL_PROVIDER=serpapi without a key gives a clear error", /SERPAPI_API_KEY is not set/.test(await errorOf(findHotels(SEARCH, newRunContext()))));
  if (savedKey) process.env.SERPAPI_API_KEY = savedKey;

  // ---- through the MCP tool ----
  process.env.HOTEL_PROVIDER = "fixture";
  const ctx = newRunContext();
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test-hotels", version: "1" });
  await client.connect(a);
  const res = await client.callTool({
    name: "searchHotels",
    arguments: { destination: "SEA", checkIn: "2026-12-11", checkOut: "2026-12-15", travelers: 2 },
  });
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const body = JSON.parse(text) as { source: string; results: Record<string, unknown>[] };
  check("the tool reports its source", body.source === "fixture");
  check("the model doesn't see coordinates or bookkeeping", !/latitude|"kind"|checkIn|fetchedAt/.test(text));
  check("each hotel is saved for presentTrips", body.results.every((h) => ctx.results.has(h.id as string)));
  await client.close();

  // ---- a whole run on fixture flights and hotels ----
  process.env.FLIGHT_PROVIDER = "fixture";
  const request = {
    origin: "Honolulu", destinations: ["Seattle"], destinationsFromIdeas: false, departDate: "2026-12-11", returnDate: "2026-12-15",
    travelers: 2, travelersDefaulted: false, budget: 2500, preferences: [], question: null,
  };
  const hotelId = results[0].id;
  const turns: FakeTurn[] = [
    { calls: [{ name: "recordRequest", args: request }] },
    {
      calls: [
        { name: "searchFlights", args: { origin: "HNL", destination: "SEA", departDate: "2026-12-11", returnDate: "2026-12-15" } },
        { name: "searchHotels", args: { destination: "SEA", checkIn: "2026-12-11", checkOut: "2026-12-15", travelers: 2 } },
      ],
    },
    { calls: [{ name: "presentTrips", args: { budget: 2500, travelers: 2, trips: [{ flightId: "f-1444-01", hotelId, reason: "Cheapest." }] } }] },
    { text: "Done." },
  ];
  const run = await runAgent([{ role: "user", content: "x" }], undefined, { llm: fakeLlm(turns) });
  const trip = run.trips?.[0];
  check("a run on fixture flights and live-shaped hotels presents a trip", run.status === "done" && trip?.hotel.id === hotelId, JSON.stringify(run.trace.map((t) => t.result.slice(0, 80))));
  check(
    "its totals add up, with the ride estimated from the computed distance",
    !!trip && trip.totals.total === trip.totals.flights + trip.totals.hotel + trip.totals.transport && trip.totals.transport > 0,
  );
  check("the trip records where its hotel came from", trip?.sources.hotel === "fixture");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll hotel checks passed");
  process.exit(failures ? 1 : 0);
}

main();
