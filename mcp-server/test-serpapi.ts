// Run with: npx tsx mcp-server/test-serpapi.ts
// Never calls SerpApi: fetch is replaced by a stub and the cache lives in a temporary folder.
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "./createServer";
import { newRunContext } from "./lib/runContext";
import { findFlights, isRedEye, mapSerpApi } from "./lib/flightProviders";
import { cacheKey, serpapiSearch } from "./lib/serpapi";

// Weather comes from saved Open-Meteo fixtures, so presentTrips makes no network calls.
process.env.SMARTTRIP_WEATHER = "fixture";

const KEY = "test-key-5f3a9c";
const FIXTURE = path.resolve(import.meta.dirname, "../data/fixtures/serpapi-flights-HNL-SEA-2026-10-21-2026-10-27.json");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
}

/** Runs fn and returns its error message, or "" if it didn't throw. */
async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// ---- fetch stub ----
let fetchCalls = 0;
let reply: () => Response | Promise<Response> = () => Response.json({ ok: true });
globalThis.fetch = async () => {
  fetchCalls++;
  return reply();
};

async function freshCache() {
  process.env.SMARTTRIP_CACHE_DIR = await mkdtemp(path.join(tmpdir(), "smarttrip-serpapi-"));
  return process.env.SMARTTRIP_CACHE_DIR;
}
process.env.SERPAPI_API_KEY = KEY;
const params = (q: string) => ({ q, currency: "USD" });

// ---- cache ----
const dir = await freshCache();
let ctx = newRunContext();
const first = await serpapiSearch("google_hotels", params("hotels in Seattle"), ctx);
const second = await serpapiSearch("google_hotels", params("hotels in Seattle"), ctx);
check("first call is a miss, the same call again is a hit (1 fetch)", first.cache === "miss" && second.cache === "hit" && fetchCalls === 1);
check("a hit keeps the original fetchedAt", second.fetchedAt === first.fetchedAt);
check("a hit doesn't count against the run", ctx.serpapiCalls === 1);

await serpapiSearch("google_hotels", params("hotels in Portland"), ctx);
check("different parameters are a miss", fetchCalls === 2);
check(
  "cache key ignores api_key and parameter order",
  cacheKey("e", { a: "1", b: "2" }) === cacheKey("e", { b: "2", a: "1", api_key: "x" }) &&
    cacheKey("e", { a: "1" }) !== cacheKey("other", { a: "1" }),
);

const [cacheFile] = (await readdir(dir)).filter((f) => f.startsWith("google_hotels-"));
const entry = JSON.parse(await readFile(path.join(dir, cacheFile), "utf8"));
await writeFile(path.join(dir, cacheFile), JSON.stringify({ ...entry, fetchedAt: Date.now() - 25 * 60 * 60 * 1000 }));
const callsBefore = fetchCalls;
const expired = await serpapiSearch("google_hotels", { ...entry.params }, ctx);
check("an entry older than 24h is fetched again", expired.cache === "miss" && fetchCalls === callsBefore + 1);

const saved = await Promise.all((await readdir(dir)).map((f) => readFile(path.join(dir, f), "utf8")));
check("the key is never written to the cache folder", saved.every((text) => !text.includes(KEY)));

// ---- monthly counter ----
const usage = JSON.parse(await readFile(path.join(dir, "usage.json"), "utf8"));
const month = new Date().toISOString().slice(0, 7);
check("usage.json counts live calls this month (3)", usage.month === month && usage.calls === 3, JSON.stringify(usage));
await writeFile(path.join(dir, "usage.json"), JSON.stringify({ month: "2020-01", calls: 99 }));
await serpapiSearch("google_hotels", params("hotels in Eugene"), ctx);
const reset = JSON.parse(await readFile(path.join(dir, "usage.json"), "utf8"));
check("usage.json starts over in a new month", reset.month === month && reset.calls === 1, JSON.stringify(reset));

// Parallel calls must not lose counts.
await Promise.all(["a", "b", "c", "d"].map((q) => serpapiSearch("google_maps", params(q), newRunContext())));
const parallel = JSON.parse(await readFile(path.join(dir, "usage.json"), "utf8"));
check("4 parallel live calls add 4 to the counter", parallel.calls === 5, JSON.stringify(parallel));

// ---- per-run cap ----
await freshCache();
ctx = { ...newRunContext(), maxSerpapiCalls: 2 };
await serpapiSearch("google_flights", params("1"), ctx);
await serpapiSearch("google_flights", params("2"), ctx);
const beforeCap = fetchCalls;
const capError = await errorOf(() => serpapiSearch("google_flights", params("3"), ctx));
check("the call after the cap fails without calling SerpApi", /call limit for this run reached \(2\)/.test(capError) && fetchCalls === beforeCap, capError);
const afterCap = await serpapiSearch("google_flights", params("1"), ctx);
check("cached searches still work after the cap", afterCap.cache === "hit");

// ---- failures: readable, scrubbed, never retried ----
await freshCache();
ctx = newRunContext();
reply = () => Response.json({ error: "Your account has run out of searches." }, { status: 429 });
let before = fetchCalls;
const quota = await errorOf(() => serpapiSearch("google_flights", params("quota"), ctx));
check("HTTP 429 gives the quota message and is not retried", /quota is used up/.test(quota) && fetchCalls === before + 1, quota);

reply = () => Response.json({ error: `Invalid API key ${KEY}` }, { status: 401 });
const invalid = await errorOf(() => serpapiSearch("google_flights", params("bad key"), ctx));
check("an error that echoes the key is scrubbed", /looks invalid/.test(invalid) && !invalid.includes(KEY) && invalid.includes("REDACTED"), invalid);

reply = () => {
  throw new TypeError("fetch failed");
};
const network = await errorOf(() => serpapiSearch("google_flights", params("offline"), ctx));
check("a network failure gives a readable message", /Could not reach SerpApi/.test(network), network);
check("failed calls are not cached", (await readdir(process.env.SMARTTRIP_CACHE_DIR!)).every((f) => f === "usage.json"));

process.env.SERPAPI_API_KEY = "";
before = fetchCalls;
const noKey = await errorOf(() => serpapiSearch("google_flights", params("no key"), ctx));
check("no key: clear error and no request", /SERPAPI_API_KEY is not set/.test(noKey) && fetchCalls === before, noKey);
process.env.SERPAPI_API_KEY = KEY;

// ---- searchFlights in serpapi mode goes through the helper ----
await freshCache();
process.env.FLIGHT_PROVIDER = "serpapi";
const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
reply = () => Response.json(fixture);
const server = createServer(newRunContext());
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "smarttrip-test", version: "0.2.0" });
await client.connect(clientSide);
const search = { origin: "HNL", destination: "SEA", departDate: "2026-12-11", returnDate: "2026-12-15" };
before = fetchCalls;
const live = await client.callTool({ name: "searchFlights", arguments: search });
const again = await client.callTool({ name: "searchFlights", arguments: search });
const text = (r: typeof live) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
const data = JSON.parse(text(live));
check(
  "searchFlights (serpapi) maps the stubbed response and caches it (1 fetch for 2 calls)",
  !live.isError && data.source === "serpapi" && data.count > 0 && text(again) === text(live) && fetchCalls === before + 1,
  text(live).slice(0, 200),
);
await client.close();
await server.close();

// ---- full flight records stay on the server, with unique ids per search ----
process.env.FLIGHT_PROVIDER = "fixture";
const recordsCtx = newRunContext();
const fixtureSearch = { origin: "HNL", destination: "SEA", departDate: "2026-10-21", returnDate: "2026-10-27" };
const first8 = await findFlights(fixtureSearch.origin, fixtureSearch.destination, fixtureSearch.departDate, fixtureSearch.returnDate, recordsCtx);
const lax = first8.results.find((r) => r.layovers.length === 1);
check(
  "the fixture's 1-stop option has both segments and a 126-minute LAX layover",
  lax?.layovers[0].airport === "LAX" && lax.layovers[0].minutes === 126 && lax.segments.length === 2 &&
    lax.segments.map((g) => `${g.from}-${g.to}`).join() === "HNL-LAX,LAX-SEA",
  JSON.stringify(lax),
);
const overnight = first8.results.find((r) => r.departTime === "22:40");
check(
  "dates come from the segment times, and the 22:40 overnight is a red-eye landing 2026-10-22",
  first8.results.every((r) => r.departDate === "2026-10-21") && overnight?.arriveDate === "2026-10-22" && overnight.redEye,
  JSON.stringify(overnight),
);
check(
  "a 07:00 departure landing after midnight is not a red-eye; a 04:30 one is",
  isRedEye("07:00", "2026-10-21", "2026-10-22") === false && isRedEye("04:30", "2026-10-21", "2026-10-22"),
);
check("the fixture's 13 options are cut to the 8 cheapest", first8.results.length === 8);
const again8 = mapSerpApi(fixture, fixtureSearch, "fixture");
const other8 = mapSerpApi(fixture, { ...fixtureSearch, destination: "PDX" }, "fixture");
check("the same search gives the same ids", again8.map((r) => r.id).join() === first8.results.map((r) => r.id).join());
check(
  "two different searches in one run never share an id",
  other8.every((r) => !first8.results.some((f) => f.id === r.id)),
  `${first8.results[0].id} vs ${other8[0].id}`,
);

const storeServer = createServer(recordsCtx);
const [storeClientSide, storeServerSide] = InMemoryTransport.createLinkedPair();
await storeServer.connect(storeServerSide);
const storeClient = new Client({ name: "smarttrip-test", version: "0.2.0" });
await storeClient.connect(storeClientSide);
const stored = await storeClient.callTool({ name: "searchFlights", arguments: fixtureSearch });
const storedIds = JSON.parse(text(stored)).results.map((r: { id: string }) => r.id) as string[];
check(
  "searchFlights saves each full record in the run context under its id",
  storedIds.length > 0 && storedIds.every((id) => recordsCtx.results.get(id)?.kind === "flight" && "segments" in recordsCtx.results.get(id)!),
);
check("the model's view leaves out segments and tokens", !text(stored).includes("segments") && !text(stored).includes("departureToken"));
await storeClient.close();
await storeServer.close();

console.log(failures ? `\n${failures} check(s) failed` : "\nAll SerpApi helper checks passed");
process.exit(failures ? 1 : 0);
