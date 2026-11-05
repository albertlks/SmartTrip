// Run with: npx tsx scripts/capture-flight-fixtures.ts --yes
// Saves two SerpApi Google Flights responses as fixtures for the return-flight feature: an outbound search that keeps
// each option's departure_token, and the return options for its cheapest flight. Spends up to 2 SerpApi searches
// (none if the same searches were cached in the last 24 hours), so it does nothing without --yes.
// Tokens are replaced with placeholders (FIXTURE_TOKEN_<rank>) and booking tokens and metadata are dropped,
// so nothing secret or expiring is committed.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { DATA_DIR } from "../mcp-server/lib/data";
import { mapSerpApi } from "../mcp-server/lib/flightProviders";
import { projectRoot } from "../mcp-server/lib/projectRoot";
import { newRunContext } from "../mcp-server/lib/runContext";
import { serpapiSearch } from "../mcp-server/lib/serpapi";

config({ path: [path.join(projectRoot(), ".env.local"), path.join(projectRoot(), ".env")], quiet: true });

const SEARCH = { origin: "HNL", destination: "SEA", departDate: "2026-12-11", returnDate: "2026-12-15" };
// The same parameters the app sends (flightProviders.ts), so the app's own search of this route is a cache hit.
const PARAMS = {
  departure_id: SEARCH.origin,
  arrival_id: SEARCH.destination,
  outbound_date: SEARCH.departDate,
  return_date: SEARCH.returnDate,
  type: "1",
  adults: "1",
  currency: "USD",
};
const base = `${SEARCH.origin}-${SEARCH.destination}-${SEARCH.departDate}-${SEARCH.returnDate}`;
const FIXTURE_DIR = path.join(DATA_DIR, "fixtures");

type Json = unknown;

/** Drops booking tokens and metadata, and swaps each departure token for its placeholder. */
function scrub(value: Json, placeholders: Map<string, string>): Json {
  if (Array.isArray(value)) return value.map((v) => scrub(v, placeholders));
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === "booking_token" || key === "search_metadata") continue;
      out[key] = key === "departure_token" && typeof v === "string" ? (placeholders.get(v) ?? "FIXTURE_TOKEN_UNKNOWN") : scrub(v, placeholders);
    }
    return out;
  }
  return value;
}

async function save(name: string, response: Json, placeholders: Map<string, string>) {
  const text = `${JSON.stringify(scrub(response, placeholders), null, 2)}\n`;
  const leaked = [...placeholders.keys()].filter((token) => text.includes(token));
  if (leaked.length) throw new Error(`${name}: a real token survived scrubbing; nothing was saved.`);
  await writeFile(path.join(FIXTURE_DIR, name), text);
  console.log(`saved data/fixtures/${name}`);
}

async function main() {
  if (!process.argv.includes("--yes")) {
    console.log(
      `This spends up to 2 SerpApi searches (google_flights ${base}, then the return options of its cheapest flight).\n` +
        "Searches cached in the last 24 hours are free. Run again with --yes to go ahead.",
    );
    return;
  }
  const ctx = { ...newRunContext(), maxSerpapiCalls: 2 };

  const outbound = await serpapiSearch<Parameters<typeof mapSerpApi>[0]>("google_flights", PARAMS, ctx);
  const records = mapSerpApi(outbound.response, SEARCH, "serpapi");
  // Placeholders follow the app's ranking (cheapest first), so FIXTURE_TOKEN_1 belongs to flight id ...-01.
  const placeholders = new Map<string, string>();
  records.forEach((r, i) => r.departureToken && placeholders.set(r.departureToken, `FIXTURE_TOKEN_${i + 1}`));
  const cheapest = records[0];
  if (!cheapest?.departureToken) throw new Error("The cheapest option has no departure_token; nothing to fetch.");

  const returns = await serpapiSearch("google_flights", { ...PARAMS, departure_token: cheapest.departureToken }, ctx);

  await save(`serpapi-flights-${base}.json`, outbound.response, placeholders);
  await save(`serpapi-flights-return-${base}-1.json`, returns.response, placeholders);
  console.log(`SerpApi calls this run: ${ctx.serpapiCalls} (outbound ${outbound.cache}, return ${returns.cache})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
