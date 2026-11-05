// Run with: npx tsx mcp-server/test-offline.ts
// The DEMO_FALLBACK=offline switch: saved fixtures where they exist, sample data otherwise, and never a live call.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findFlights } from "./lib/flightProviders";
import { findHotels } from "./lib/hotelProviders";
import { demoOffline, providerFor } from "./lib/providers";
import { newRunContext } from "./lib/runContext";
import { cacheKey, serpapiSearch } from "./lib/serpapi";
import { getWeather } from "./lib/weather";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function main() {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "smarttrip-offline-"));
  process.env.SMARTTRIP_CACHE_DIR = cacheDir;
  process.env.FLIGHT_PROVIDER = "serpapi";
  process.env.HOTEL_PROVIDER = "serpapi";
  process.env.SERPAPI_API_KEY = "would-be-used-if-anything-went-live";
  delete process.env.SMARTTRIP_WEATHER;

  check("off by default: the provider settings apply", !demoOffline() && providerFor("FLIGHT") === "serpapi");

  process.env.DEMO_FALLBACK = "offline";
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args.join(" ")); // the one-time "[demo]" notice goes to the log
  check("on: every provider reads saved fixtures first", demoOffline() && providerFor("FLIGHT") === "fixture" && providerFor("HOTEL") === "fixture");
  console.error = originalError;
  check("turning it on is logged once", errors.filter((e) => e.startsWith("[demo]")).length === 1);

  const ctx = newRunContext();
  const saved = await findFlights("HNL", "SEA", "2026-12-11", "2026-12-15", ctx);
  check("a route with a saved search uses it", saved.source === "fixture" && saved.results.every((r) => r.source === "fixture"));
  const sample = await findFlights("HNL", "LAS", "2026-12-11", "2026-12-15", ctx);
  check("a route without one uses sample data, labelled as such", sample.source === "mock" && sample.results.every((r) => r.source === "mock"));

  const stay = { checkIn: "2026-12-11", checkOut: "2026-12-15", sort: "price" as const };
  const savedHotels = await findHotels({ ...stay, destination: "SEA", travelers: 2 }, ctx);
  check("hotels with a saved search use it", savedHotels.source === "fixture" && savedHotels.results.length > 0);
  const sampleHotels = await findHotels({ ...stay, destination: "LAS", travelers: 2 }, ctx);
  check("hotels without one use sample data", sampleHotels.source === "mock" && sampleHotels.results.every((r) => r.source === "mock"));
  check("nothing went live", ctx.serpapiCalls === 0);

  // SerpApi itself refuses live calls, but still serves what's cached (it's free).
  const params = { q: "anything" };
  check(
    "an uncached SerpApi search is refused, with the reason",
    /Live search is off for this demo/.test(await errorOf(serpapiSearch("google_hotels", params, newRunContext()))),
  );
  await mkdir(cacheDir, { recursive: true });
  const entry = { fetchedAt: Date.now(), engine: "google_hotels", params, response: { properties: [] } };
  await writeFile(path.join(cacheDir, `google_hotels-${cacheKey("google_hotels", params)}.json`), JSON.stringify(entry));
  const cached = await serpapiSearch("google_hotels", params, newRunContext());
  check("a cached search is still served", cached.cache === "hit");

  // Weather comes from saved files too: Seattle has one, Las Vegas doesn't.
  const today = "2026-11-04";
  const seattle = await getWeather("SEA", "2026-12-11", "2026-12-15", { today });
  check("weather with a saved file works offline", seattle.days.length === 5);
  check(
    "weather without one fails (shown as 'Weather not found'), with no network call",
    /no saved weather fixture/.test(await errorOf(getWeather("LAS", "2026-12-11", "2026-12-15", { today }))),
  );

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll offline-switch checks passed");
  process.exit(failures ? 1 : 0);
}

main();
