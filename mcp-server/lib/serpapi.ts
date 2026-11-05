import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./data";
import { demoOffline } from "./providers";
import { ToolFailure } from "./results";
import type { RunContext } from "./runContext";

// Every SerpApi call goes through serpapiSearch: the free plan allows 250 searches a month,
// so each one is cached for a day, capped per run, counted per month, and never retried.

export class SerpApiError extends ToolFailure {}

export type SerpApiResult<T> = {
  response: T;
  cache: "hit" | "miss";
  /** When the response was fetched from SerpApi (ms since epoch); older than now for a cache hit. */
  fetchedAt: number;
};

type CacheEntry = { fetchedAt: number; engine: string; params: Record<string, string>; response: unknown };
type Usage = { month: string; calls: number };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** SMARTTRIP_CACHE_DIR lets tests use a temporary folder instead of data/cache/. */
const cacheDir = () => process.env.SMARTTRIP_CACHE_DIR ?? path.join(DATA_DIR, "cache");

const log = (message: string) => console.error(`[serpapi] ${message}`);

/** Same engine and parameters give the same key; api_key is never part of it. */
export function cacheKey(engine: string, params: Record<string, string>): string {
  const query = Object.keys(params)
    .filter((k) => k !== "api_key")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(`${engine}?${query}`).digest("hex").slice(0, 16);
}

/** When a search's cached response was fetched (ms), if it is still within the 24h window; null otherwise. Costs nothing. */
export async function cachedAt(engine: string, params: Record<string, string>): Promise<number | null> {
  const file = path.join(cacheDir(), `${engine}-${cacheKey(engine, params)}.json`);
  const entry = await readFile(file, "utf8")
    .then((t) => JSON.parse(t) as CacheEntry)
    .catch(() => null);
  return entry && typeof entry.fetchedAt === "number" && Date.now() - entry.fetchedAt < CACHE_TTL_MS ? entry.fetchedAt : null;
}

function age(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

// Tools can run in parallel, so counter updates are chained to avoid losing a count.
let usageUpdate: Promise<Usage> = Promise.resolve({ month: "", calls: 0 });

/** Adds one live call to data/cache/usage.json, starting over in a new month. */
function countCall(dir: string): Promise<Usage> {
  usageUpdate = usageUpdate.then(async () => {
    const file = path.join(dir, "usage.json");
    const month = new Date().toISOString().slice(0, 7);
    const saved = await readFile(file, "utf8")
      .then((t) => JSON.parse(t) as Usage)
      .catch(() => null);
    const usage = { month, calls: (saved?.month === month ? saved.calls : 0) + 1 };
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(usage));
    return usage;
  });
  return usageUpdate;
}

/**
 * One SerpApi search, from the 24h disk cache when possible. A live call counts against the run's cap
 * (ctx.maxSerpapiCalls) and the monthly counter. Throws SerpApiError with a readable message on any failure.
 */
export async function serpapiSearch<T>(
  engine: string,
  params: Record<string, string>,
  ctx: RunContext,
): Promise<SerpApiResult<T>> {
  const dir = cacheDir();
  const file = path.join(dir, `${engine}-${cacheKey(engine, params)}.json`);

  const cached = await readFile(file, "utf8")
    .then((t) => JSON.parse(t) as CacheEntry)
    .catch(() => null);
  if (cached && typeof cached.fetchedAt === "number" && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    log(`${engine} hit, cached ${age(Date.now() - cached.fetchedAt)} ago`);
    return { response: cached.response as T, cache: "hit", fetchedAt: cached.fetchedAt };
  }

  // Cache hits above are still served: they cost nothing.
  if (demoOffline()) {
    throw new SerpApiError("Live search is off for this demo (DEMO_FALLBACK=offline); only saved results can be shown.");
  }
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    throw new SerpApiError(
      "A provider is set to serpapi but SERPAPI_API_KEY is not set. Add it to .env.local, or use the fixture provider.",
    );
  }
  if (ctx.serpapiCalls >= ctx.maxSerpapiCalls) {
    throw new SerpApiError(
      `SerpApi call limit for this run reached (${ctx.maxSerpapiCalls}). ` +
        "Searches already made in the last day still work; reuse one, or present what you have.",
    );
  }
  // Counted before the request so parallel calls can't overshoot the cap.
  ctx.serpapiCalls++;
  const usage = await countCall(dir);
  log(`${engine} miss, calling SerpApi (run ${ctx.serpapiCalls}/${ctx.maxSerpapiCalls}, this month ${usage.calls})`);

  const url = new URL("https://serpapi.com/search");
  url.search = new URLSearchParams({ engine, ...params, api_key: apiKey }).toString();
  const scrub = (s: string) => s.split(apiKey).join("REDACTED");

  // No retries and no fallback to mock data: every live call spends quota.
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new SerpApiError(
      `Could not reach SerpApi (${scrub(err instanceof Error ? err.message : String(err))}). ` +
        "Check the network, or use the fixture provider.",
    );
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok || body.error) {
    const detail = scrub(body.error ?? `HTTP ${res.status}`);
    const hint =
      res.status === 401
        ? "SERPAPI_API_KEY looks invalid."
        : res.status === 429
          ? "The SerpApi search quota is used up."
          : "SerpApi returned an error.";
    throw new SerpApiError(`${hint} (${detail}) Use the fixture provider for the demo.`);
  }

  const entry: CacheEntry = { fetchedAt: Date.now(), engine, params, response: body };
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(entry));
  return { response: body as T, cache: "miss", fetchedAt: entry.fetchedAt };
}
