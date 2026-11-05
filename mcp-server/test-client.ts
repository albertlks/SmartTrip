// Run with: npx tsx mcp-server/test-client.ts
// Never calls SerpApi: serpapi mode is only tested with the key blanked out.
import { spawn } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const SERVER = path.join(import.meta.dirname, "server.ts");
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../data/fixtures");
// An empty cache, so serpapi-mode checks never hit a real cached search.
const EMPTY_CACHE = await mkdtemp(path.join(tmpdir(), "smarttrip-cache-"));
const FLIGHT_FIELDS = ["flightNumber", "origin", "destination", "departDate", "departTime", "arriveDate", "arriveTime"];

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
}

async function connect(env: Record<string, string> = {}) {
  const client = new Client({ name: "smarttrip-test", version: "0.2.0" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", SERVER], env }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: result.isError === true, text, data };
}

// ---- Default (mock) provider ----
const client = await connect();

const { tools } = await client.listTools();
check(`server lists 6 tools (${tools.map((t) => t.name).join(", ")})`, tools.length === 6);

// Chain: 2 travelers, HNL -> SEA, 4 nights.
const airport = await call(client, "lookupAirport", { query: "Seattle" });
const sea = airport.data?.results?.[0]?.code;
check("lookupAirport('Seattle') -> SEA first", sea === "SEA", airport.text);

// Main airport first for multi-airport cities, aliases, accents, and the codes the mock data uses.
const lookups: [string, string][] = [
  ["Portland", "PDX"], ["New York", "JFK"], ["NYC", "JFK"], ["Chicago", "ORD"], ["Maui", "OGG"],
  ["Honolulu", "HNL"], ["Cancun", "CUN"], ["Eugene", "EUG"], ["hnl", "HNL"],
];
for (const [query, code] of lookups) {
  const r = await call(client, "lookupAirport", { query });
  check(`lookupAirport('${query}') -> ${code} first`, r.data?.results?.[0]?.code === code, r.text.slice(0, 200));
}

const flights = await call(client, "searchFlights", {
  origin: "HNL", destination: sea, departDate: "2026-11-14", returnDate: "2026-11-18",
});
const flight = flights.data?.results?.[0];
check("searchFlights HNL->SEA returns results with source 'mock'", !flights.isError && flights.data.source === "mock", flights.text.slice(0, 200));
check(
  "every flight result has the section 2 fields",
  !flights.isError && flights.data.results.every((r: any) => FLIGHT_FIELDS.every((f) => typeof r[f] === "string")),
);
check(
  "searchFlights lists airport names once (HNL and SEA)",
  typeof flights.data?.airports?.HNL === "string" && typeof flights.data?.airports?.SEA === "string",
  JSON.stringify(flights.data?.airports),
);
const byId = (id: string) => flights.data?.results?.find((r: any) => r.id === id);
check("mock flights leave on the searched date", flights.data?.results?.every((r: any) => r.departDate === "2026-11-14"));
check(
  "mock f002 (21:45 -> 09:15) is a red-eye landing the next day; f001 (07:30) is not flagged",
  byId("f002")?.redEye === true && byId("f002")?.arriveDate === "2026-11-15" && !("redEye" in (byId("f001") ?? {})),
  JSON.stringify([byId("f001"), byId("f002")]),
);
const tokyo = await call(client, "searchFlights", { origin: "HNL", destination: "HND", departDate: "2026-11-14", returnDate: "2026-11-21" });
check(
  "Tokyo flights land the next day (arriveDayOffset) without being red-eyes",
  tokyo.data?.results?.every((r: any) => r.arriveDate === "2026-11-15" && !r.redEye),
  tokyo.text.slice(0, 300),
);

const hotels = await call(client, "searchHotels", { destination: "SEA", checkIn: "2026-11-14", checkOut: "2026-11-18" });
const hotel = hotels.data?.results?.[0];
check(
  "searchHotels SEA -> 4 nights, cheapest first, stayTotal = price x nights",
  hotels.data?.nights === 4 && hotel?.stayTotal === hotel?.pricePerNight * 4 &&
    hotels.data.results.every((h: any, i: number, a: any[]) => i === 0 || a[i - 1].pricePerNight <= h.pricePerNight),
  hotels.text.slice(0, 200),
);

const transport = await call(client, "estimateTransport", { milesToAirport: hotel?.milesToAirport, travelers: 2 });
const expectedTransport = (8 + 2.5 * hotel?.milesToAirport) * 2;
check(`estimateTransport -> round trip, 1 vehicle ($${expectedTransport})`, transport.data?.estimatedCost === expectedTransport && transport.data?.vehicles === 1, transport.text);

const budget = await call(client, "checkBudget", {
  budget: 2000, flightCost: flight?.price, travelers: 2,
  hotelCostPerNight: hotel?.pricePerNight, nights: hotels.data?.nights, transportCost: transport.data?.estimatedCost,
});
const expectedTotal = flight?.price * 2 + hotel?.pricePerNight * 4 + transport.data?.estimatedCost;
check(`checkBudget chain total = flights x2 + hotel x4 + transport ($${expectedTotal})`, budget.data?.total === expectedTotal, budget.text);

// Regression: flightCost is per person.
const doubled = await call(client, "checkBudget", { budget: 1000, flightCost: 385, travelers: 2 });
check("checkBudget doubles a per-person flight for 2 travelers (385 -> 770)", doubled.data?.breakdown?.flights === 770 && doubled.data?.total === 770, doubled.text);

const vehicles = await call(client, "estimateTransport", { milesToAirport: 10, travelers: 5, roundTrip: false });
check("estimateTransport: 5 travelers -> 2 vehicles, one way", vehicles.data?.vehicles === 2 && vehicles.data?.estimatedCost === 66, vehicles.text);

// ---- presentTrips: ids from this session's searches, totals and ranking by the server ----
const presentSchema = tools.find((t) => t.name === "presentTrips")?.inputSchema as any;
const tripFields = Object.keys(presentSchema?.properties?.trips?.items?.properties ?? {}).sort().join(",");
check("presentTrips takes ids and a reason per trip, never a price", tripFields === "activityIds,flightId,hotelId,reason", tripFields);

const byPrice = (list: any[], key: string) => [...list].sort((a, b) => a[key] - b[key]);
const [cheapFlight] = byPrice(flights.data.results, "price");
const dearFlight = byPrice(flights.data.results, "price").at(-1);
const [cheapHotel] = byPrice(hotels.data.results, "pricePerNight");
const dearHotel = byPrice(hotels.data.results, "pricePerNight").at(-1);
// 2 travelers fit in 1 vehicle: $8 base + $2.50/mile each way.
const tripTotal = (f: any, h: any) => f.price * 2 + h.pricePerNight * 4 + (8 + 2.5 * h.milesToAirport) * 2;
const fitsBudget = tripTotal(cheapFlight, cheapHotel) + 1;
const presented = await call(client, "presentTrips", {
  budget: fitsBudget,
  travelers: 2,
  trips: [
    { flightId: dearFlight.id, hotelId: dearHotel.id, reason: "Nonstop and closest to downtown." },
    { flightId: cheapFlight.id, hotelId: cheapHotel.id, reason: "Lowest total." },
  ],
});
const [t1, t2] = presented.data?.trips ?? [];
check(
  "presentTrips moves an over-budget trip listed first below the one that fits",
  t1?.flightId === cheapFlight.id && t1.rank === 1 && t1.withinBudget && t2?.flightId === dearFlight.id && !t2.withinBudget,
  presented.text,
);
check(
  `presentTrips totals are computed by the server ($${tripTotal(cheapFlight, cheapHotel)} and $${tripTotal(dearFlight, dearHotel)})`,
  t1?.total === tripTotal(cheapFlight, cheapHotel) && t2?.total === tripTotal(dearFlight, dearHotel),
  presented.text,
);

const pdxHotel = (await call(client, "searchHotels", { destination: "PDX", checkIn: "2026-11-14", checkOut: "2026-11-18" })).data.results[0];
const presentErrors: [string, object[], RegExp][] = [
  ["unknown flightId", [{ flightId: "nope", hotelId: cheapHotel.id, reason: "x" }], /unknown flightId "nope"/],
  ["unknown hotelId", [{ flightId: cheapFlight.id, hotelId: "h999", reason: "x" }], /unknown hotelId "h999"/],
  ["flight and hotel in different cities", [{ flightId: cheapFlight.id, hotelId: pdxHotel.id, reason: "x" }], /goes to SEA but hotel .* is in PDX/],
  [
    "the same package twice",
    [{ flightId: cheapFlight.id, hotelId: cheapHotel.id, reason: "x" }, { flightId: cheapFlight.id, hotelId: cheapHotel.id, reason: "y" }],
    /repeats flight/,
  ],
  ["unknown activityId", [{ flightId: cheapFlight.id, hotelId: cheapHotel.id, activityIds: ["a1"], reason: "x" }], /unknown activityId "a1"/],
  ["a price in the reason", [{ flightId: cheapFlight.id, hotelId: cheapHotel.id, reason: "Cheapest overall at under $850 total." }], /must not contain prices/],
  ["a price in USD in the reason", [{ flightId: cheapFlight.id, hotelId: cheapHotel.id, reason: "Saves 200 USD." }], /must not contain prices/],
  ["6 trips", Array(6).fill({ flightId: cheapFlight.id, hotelId: cheapHotel.id, reason: "x" }), /at most 5/],
];
const plainReason = await call(client, "presentTrips", {
  budget: 2000, travelers: 2, trips: [{ flightId: cheapFlight.id, hotelId: cheapHotel.id, reason: "Rating 4.6, 0.3 mi from downtown, 2 free bags." }],
});
check("presentTrips accepts a reason with non-price numbers", !plainReason.isError, plainReason.text);
for (const [label, trips, pattern] of presentErrors) {
  const r = await call(client, "presentTrips", { budget: 2000, travelers: 2, trips });
  check(`presentTrips error: ${label}`, r.isError && pattern.test(r.text), r.text);
}

// Invalid inputs: each must be a clear toolError, not a crash.
const invalid: [string, string, Record<string, unknown>, RegExp][] = [
  ["bad airport code", "searchFlights", { origin: "HNL", destination: "SEATTLE", departDate: "2026-11-14", returnDate: "2026-11-18" }, /3-letter IATA airport code/],
  ["checkOut before checkIn", "searchHotels", { destination: "SEA", checkIn: "2026-11-18", checkOut: "2026-11-14" }, /checkOut .* must be after checkIn/],
  ["nights without hotelCostPerNight", "checkBudget", { budget: 1000, flightCost: 300, travelers: 1, nights: 3 }, /nights was given without hotelCostPerNight/],
  ["no matching airport", "lookupAirport", { query: "Atlantis" }, /No airport found for "Atlantis"/],
  ["unknown route", "searchFlights", { origin: "SEA", destination: "LAX", departDate: "2026-11-14", returnDate: "2026-11-18" }, /Routes with flights:/],
  ["hotel destination with no hotels", "searchHotels", { destination: "ORD", checkIn: "2026-11-14", checkOut: "2026-11-18" }, /Destinations with hotels:/],
  ["zero travelers", "estimateTransport", { milesToAirport: 5, travelers: 0 }, /travelers must be at least 1/],
];
for (const [label, tool, args, pattern] of invalid) {
  const r = await call(client, tool, args);
  check(`error: ${label} (${tool})`, r.isError && pattern.test(r.text), r.text);
}
await client.close();

// ---- Fixture provider ----
const fixtures = (await readdir(FIXTURE_DIR).catch(() => [] as string[])).filter((f) => /^serpapi-flights-.*\.json$/.test(f));
const fixtureClient = await connect({ FLIGHT_PROVIDER: "fixture" });
if (fixtures.length === 0) {
  const r = await call(fixtureClient, "searchFlights", { origin: "HNL", destination: "SEA", departDate: "2026-11-14", returnDate: "2026-11-18" });
  check("fixture mode with no saved fixture -> clear toolError", r.isError && /No fixtures are saved yet/.test(r.text), r.text);
  console.log("SKIP  fixture mapping: no file in data/fixtures/ yet (see .env.example for how to save one)");
} else {
  for (const file of fixtures) {
    const [, , origin, destination, ...dates] = file.replace(/\.json$/, "").split("-");
    const departDate = dates.slice(0, 3).join("-");
    const returnDate = dates.slice(3, 6).join("-");
    const r = await call(fixtureClient, "searchFlights", { origin, destination, departDate, returnDate });
    check(`fixture ${file}: source 'fixture' with mapped results`, !r.isError && r.data.source === "fixture" && r.data.count > 0, r.text.slice(0, 300));
    const missing = r.data?.results?.flatMap((x: any) => FLIGHT_FIELDS.filter((f) => !(f in x)).map((f) => `${x.id}.${f}`)) ?? [];
    check(`fixture ${file}: every result has the section 2 fields`, !r.isError && missing.length === 0, missing.join(", "));
    check(`fixture ${file}: 8 results stay under 2.5 KB for the model (${r.text.length} bytes)`, r.text.length < 2500);
    check(
      `fixture ${file}: ids carry a search fingerprint, e.g. f-xxxx-01`,
      r.data?.results?.every((x: any) => /^f-[0-9a-f]{4}-\d{2}$/.test(x.id)),
      r.data?.results?.map((x: any) => x.id).join(", "),
    );
  }
}
await fixtureClient.close();

// ---- SerpApi provider without a key (blank key: dotenv won't override it, so no live call) ----
const noKey = await connect({ FLIGHT_PROVIDER: "serpapi", SERPAPI_API_KEY: "", SMARTTRIP_CACHE_DIR: EMPTY_CACHE });
const noKeyResult = await call(noKey, "searchFlights", { origin: "HNL", destination: "SEA", departDate: "2026-11-14", returnDate: "2026-11-18" });
check("serpapi mode without a key -> clear toolError", noKeyResult.isError && /SERPAPI_API_KEY is not set/.test(noKeyResult.text), noKeyResult.text);
await noKey.close();

// ---- stdout carries only MCP protocol messages ----
const stdoutLines = await new Promise<string[]>((resolve) => {
  const child = spawn("npx", ["tsx", SERVER], { env: { ...process.env, FLIGHT_PROVIDER: "serpapi", SERPAPI_API_KEY: "", SMARTTRIP_CACHE_DIR: EMPTY_CACHE } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "searchFlights", arguments: { origin: "HNL", destination: "SEA", departDate: "2026-11-14", returnDate: "2026-11-18" } } });
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "checkBudget", arguments: { budget: 100, flightCost: 50, travelers: 1, nights: 2 } } });
  setTimeout(() => {
    child.kill();
    resolve(out.split("\n").filter((l) => l.trim()));
  }, 6000);
});
const nonProtocol = stdoutLines.filter((l) => {
  try {
    return JSON.parse(l).jsonrpc !== "2.0";
  } catch {
    return true;
  }
});
check(`stdout has only JSON-RPC messages (${stdoutLines.length} lines, 4 responses expected)`, stdoutLines.length === 4 && nonProtocol.length === 0, nonProtocol.join("\n"));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
