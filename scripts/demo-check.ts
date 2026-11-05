// Run with: npm run demo:check        (asks before spending any SerpApi search)
//           npm run demo:check -- --yes
// On the demo day: checks the LLM gateway, SerpApi, Open-Meteo, and disk space (all free), then reports which demo
// searches are cached and warms the rest after a yes. Warming calls the searches directly with the app's own
// parameters, so it costs SerpApi searches but no model tokens. The demo requests live in data/demo-requests.json.
import { readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { createLlm, llmProvider } from "../agent/llm";
import { DATA_DIR } from "../mcp-server/lib/data";
import { flightParams, mapSerpApi, type FlightSearch } from "../mcp-server/lib/flightProviders";
import { destinationAirport, hotelParams } from "../mcp-server/lib/hotelProviders";
import { projectRoot } from "../mcp-server/lib/projectRoot";
import { demoOffline } from "../mcp-server/lib/providers";
import { newRunContext } from "../mcp-server/lib/runContext";
import { cachedAt, serpapiSearch } from "../mcp-server/lib/serpapi";

export type DemoRequest = {
  id: string;
  message: string;
  answer?: string;
  refines?: string;
  trip?: FlightSearch & { travelers: number };
  expect: string;
};

export type PlannedSearch = { request: string; what: string; engine: string; params: Record<string, string> };

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_FREE_GB = 2;

export async function loadDemoRequests(): Promise<DemoRequest[]> {
  return JSON.parse(await readFile(path.join(DATA_DIR, "demo-requests.json"), "utf8")) as DemoRequest[];
}

/** The flight and hotel searches each demo request will make, with the exact parameters the app sends. */
export async function plannedSearches(requests: DemoRequest[]): Promise<PlannedSearch[]> {
  const out: PlannedSearch[] = [];
  for (const r of requests) {
    if (!r.trip) continue;
    const { travelers, ...flight } = r.trip;
    out.push({ request: r.id, what: `flights ${flight.origin}-${flight.destination}`, engine: "google_flights", params: flightParams(flight) });
    const { city } = await destinationAirport(flight.destination);
    const stay = { destination: flight.destination, checkIn: flight.departDate, checkOut: flight.returnDate, travelers, sort: "price" as const };
    out.push({ request: r.id, what: `hotels in ${city}`, engine: "google_hotels", params: hotelParams(stay, city) });
  }
  return out;
}

/** The return-flight search for the cheapest outbound option, once the outbound search is cached; null before that. */
async function returnSearch(outbound: PlannedSearch, search: FlightSearch): Promise<PlannedSearch | null> {
  if ((await cachedAt(outbound.engine, outbound.params)) === null) return null;
  // A cache hit: costs nothing, and gives the token the app would use for the cheapest flight's returns.
  const { response } = await serpapiSearch<Parameters<typeof mapSerpApi>[0]>(outbound.engine, outbound.params, newRunContext());
  let token: string | undefined;
  try {
    token = mapSerpApi(response, search, "serpapi")[0]?.departureToken;
  } catch {
    return null; // no priced flights in that response: there are no returns to warm
  }
  return token ? { request: outbound.request, what: "return options (cheapest flight)", engine: "google_flights", params: { ...outbound.params, departure_token: token } } : null;
}

const expiresIn = (fetchedAt: number) => `${Math.max(0, Math.round((fetchedAt + DAY_MS - Date.now()) / 3_600_000))}h`;

type Check = { name: string; ok: boolean; detail: string };

/** Free checks: nothing here spends tokens or SerpApi searches. */
export async function readinessChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const provider = llmProvider();
  try {
    await createLlm(provider).models.list({ timeout: 10_000 });
    checks.push({ name: "LLM", ok: true, detail: `${provider.name} answers; model ${provider.model}` });
  } catch (err) {
    checks.push({ name: "LLM", ok: false, detail: `${provider.name} unreachable (${err instanceof Error ? err.message : err}). VPN off, or try a hotspot.` });
  }
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key) {
    checks.push({ name: "SerpApi", ok: false, detail: "SERPAPI_API_KEY is not set in .env.local." });
  } else {
    try {
      const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) });
      const body = (await res.json()) as { plan_searches_left?: number; error?: string };
      checks.push(
        body.error || !res.ok
          ? { name: "SerpApi", ok: false, detail: `account check failed (${body.error ?? res.status}).` }
          : { name: "SerpApi", ok: true, detail: `${body.plan_searches_left} searches left this month` },
      );
    } catch (err) {
      checks.push({ name: "SerpApi", ok: false, detail: `unreachable (${err instanceof Error ? err.message : err}).` });
    }
  }
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=21.32&longitude=-157.92&daily=temperature_2m_max&forecast_days=1", {
      signal: AbortSignal.timeout(10_000),
    });
    checks.push({ name: "Open-Meteo", ok: res.ok, detail: res.ok ? "answers" : `HTTP ${res.status}; trips will show "Weather not found".` });
  } catch {
    checks.push({ name: "Open-Meteo", ok: false, detail: 'unreachable; trips will show "Weather not found".' });
  }
  const fs = await statfs(projectRoot());
  const freeGb = (fs.bavail * fs.bsize) / 1e9;
  checks.push({ name: "Disk", ok: freeGb >= MIN_FREE_GB, detail: `${freeGb.toFixed(1)} GB free${freeGb < MIN_FREE_GB ? "; free some space before starting the server" : ""}` });
  const flights = process.env.FLIGHT_PROVIDER ?? "mock";
  const hotels = process.env.HOTEL_PROVIDER ?? "mock";
  const live = flights === "serpapi" && hotels === "serpapi";
  checks.push({
    name: "Providers",
    ok: live && !demoOffline(),
    detail: demoOffline()
      ? "DEMO_FALLBACK=offline is on: saved searches and sample data only."
      : `FLIGHT_PROVIDER=${flights}, HOTEL_PROVIDER=${hotels}${live ? "" : "; set both to serpapi for live data (the warmed cache is only used then)"}`,
  });
  return checks;
}

type Options = { yes: boolean; confirm: (question: string) => Promise<boolean>; log: (line: string) => void; skipChecks?: boolean };

/** Reports the cache, asks, and warms. Returns how many live searches were made. */
export async function runDemoCheck({ yes, confirm, log, skipChecks }: Options): Promise<{ uncached: number; liveCalls: number }> {
  if (!skipChecks) {
    log("Checks (free):");
    for (const c of await readinessChecks()) log(`  ${c.ok ? "OK  " : "FIX "} ${c.name}: ${c.detail}`);
  }

  const requests = await loadDemoRequests();
  const searches = await plannedSearches(requests);
  log("\nDemo searches:");
  const missing: PlannedSearch[] = [];
  for (const s of searches) {
    const at = await cachedAt(s.engine, s.params);
    log(`  ${s.request.padEnd(9)} ${s.what.padEnd(34)} ${at ? `cached, expires in ${expiresIn(at)}` : "not cached"}`);
    if (!at) missing.push(s);
  }
  // Return options need the outbound search's token, so they are counted (and warmed) after their outbound search.
  const outbounds = searches.filter((s) => s.engine === "google_flights");
  const tripOf = (o: PlannedSearch) => requests.find((r) => r.id === o.request)!.trip!;
  let returnsMissing = 0;
  for (const o of outbounds) {
    const ret = await returnSearch(o, tripOf(o));
    const at = ret && (await cachedAt(ret.engine, ret.params));
    log(`  ${o.request.padEnd(9)} ${"return options (cheapest flight)".padEnd(34)} ${at ? `cached, expires in ${expiresIn(at)}` : "not cached"}`);
    if (!at) returnsMissing++;
  }
  const uncached = missing.length + returnsMissing;

  if (uncached === 0) {
    log("\nEverything is cached. Nothing to spend.");
    return { uncached, liveCalls: 0 };
  }
  log(`\nWarming needs ${uncached} SerpApi search${uncached === 1 ? "" : "es"} from your monthly quota.`);
  if (!yes && !(await confirm(`Spend ${uncached} search${uncached === 1 ? "" : "es"} now? [y/N] `))) {
    log("Nothing was spent.");
    return { uncached, liveCalls: 0 };
  }

  const ctx = { ...newRunContext(), maxSerpapiCalls: uncached };
  for (const s of missing) {
    try {
      await serpapiSearch(s.engine, s.params, ctx);
      log(`  warmed ${s.request} ${s.what}`);
    } catch (err) {
      log(`  FAILED ${s.request} ${s.what}: ${err instanceof Error ? err.message : err}`);
    }
  }
  for (const o of outbounds) {
    const ret = await returnSearch(o, tripOf(o));
    if (!ret || (await cachedAt(ret.engine, ret.params))) continue;
    try {
      await serpapiSearch(ret.engine, ret.params, ctx);
      log(`  warmed ${o.request} return options`);
    } catch (err) {
      log(`  FAILED ${o.request} return options: ${err instanceof Error ? err.message : err}`);
    }
  }
  log(`\nLive SerpApi searches made: ${ctx.serpapiCalls}. The cache lasts 24 hours.`);
  return { uncached, liveCalls: ctx.serpapiCalls };
}

async function askOnTerminal(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  config({ path: [path.join(projectRoot(), ".env.local"), path.join(projectRoot(), ".env")], quiet: true });
  runDemoCheck({ yes: process.argv.includes("--yes"), confirm: askOnTerminal, log: (l) => console.log(l) }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
