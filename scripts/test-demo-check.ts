// Run with: npx tsx scripts/test-demo-check.ts
// No network: SerpApi is never reached (no key, and fetch is watched), and the cache is a temporary folder.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheKey } from "../mcp-server/lib/serpapi";
import { loadDemoRequests, plannedSearches, runDemoCheck } from "./demo-check";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

async function main() {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "smarttrip-demo-check-"));
  process.env.SMARTTRIP_CACHE_DIR = cacheDir;
  process.env.SERPAPI_API_KEY = "";
  delete process.env.DEMO_FALLBACK;
  let networkCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    networkCalls++;
    return realFetch(...args);
  }) as typeof fetch;

  const requests = await loadDemoRequests();
  check("every demo request has a message and what to expect", requests.length >= 3 && requests.every((r) => r.message && r.expect));
  check("a refine names the request it refines", requests.filter((r) => r.refines).every((r) => requests.some((p) => p.id === r.refines)));
  const searches = await plannedSearches(requests);
  const trips = requests.filter((r) => r.trip).length;
  check(`each trip plans a flight and a hotel search (${searches.length})`, searches.length === trips * 2);
  const seattleHotels = searches.find((s) => s.request === "seattle" && s.engine === "google_hotels");
  check(
    "hotel searches use the app's parameters (city, guests, cheapest first)",
    seattleHotels?.params.q === "hotels in Seattle" && seattleHotels.params.adults === "2" && seattleHotels.params.sort_by === "3",
  );

  const lines: string[] = [];
  const declined = await runDemoCheck({ yes: false, confirm: async () => false, log: (l) => lines.push(l), skipChecks: true });
  check("everything uncached is counted, returns included", declined.uncached === trips * 3, `${declined.uncached}`);
  check("declining spends nothing", declined.liveCalls === 0 && lines.includes("Nothing was spent.") && networkCalls === 0);

  const tried = await runDemoCheck({ yes: true, confirm: async () => true, log: () => {}, skipChecks: true });
  check("with a yes but no key, nothing reaches SerpApi", tried.liveCalls === 0 && networkCalls === 0, `${networkCalls} network calls`);

  // A cached search is reported as cached and isn't counted again.
  const flights = searches.find((s) => s.request === "seattle" && s.engine === "google_flights")!;
  await mkdir(cacheDir, { recursive: true });
  const saved = JSON.parse(await readFile(path.resolve(import.meta.dirname, "../data/fixtures/serpapi-flights-HNL-SEA-2026-12-11-2026-12-15.json"), "utf8"));
  const entry = { fetchedAt: Date.now() - 3 * 3_600_000, engine: flights.engine, params: flights.params, response: saved };
  await writeFile(path.join(cacheDir, `${flights.engine}-${cacheKey(flights.engine, flights.params)}.json`), JSON.stringify(entry));
  const report: string[] = [];
  const after = await runDemoCheck({ yes: false, confirm: async () => false, log: (l) => report.push(l), skipChecks: true });
  check("a cached search shows when it expires", report.some((l) => /seattle\s+flights HNL-SEA\s+cached, expires in 21h/.test(l)), report.join("\n"));
  check("and isn't counted again", after.uncached === declined.uncached - 1);
  check("its return options are listed as still to warm", report.some((l) => /seattle\s+return options \(cheapest flight\)\s+not cached/.test(l)));
  check("still no network calls", networkCalls === 0);

  globalThis.fetch = realFetch;
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll demo:check checks passed");
  process.exit(failures ? 1 : 0);
}

main();
