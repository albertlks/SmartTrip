import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { loadAirports, type Airport } from "../lib/data";
import { jsonResult, toolError } from "../lib/results";

const MAX_RESULTS = 5;

export const lookupAirportInput = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'query must be at least 2 characters: a city, airport name, or code, e.g. "Seattle" or "SEA".')
    .describe('City, airport name, or 3-letter code to look up, e.g. "Seattle", "Portland International", or "PDX".'),
});

const SIZE_ORDER = { large: 0, medium: 1, small: 2 };

/** Lowercase without accents, so "Cancun" matches "Cancún". */
const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Exact code first, then exact city (or the part before a comma, so "Honolulu" matches "Honolulu, Oahu"),
 * then an exact alias ("NYC", "Maui"), then any partial match. Within each step the city's main airport comes first,
 * then larger airports.
 */
export function lookupAirport(airports: Airport[], query: string) {
  const q = normalize(query);
  const rank = (a: Airport) => {
    const city = normalize(a.city);
    const keywords = (a.keywords ?? []).map(normalize);
    if (a.code.toLowerCase() === q) return 0;
    if (city === q || city.split(",")[0].trim() === q) return 1;
    if (keywords.includes(q)) return 2;
    if ([a.code.toLowerCase(), city, normalize(a.name), ...keywords].some((field) => field.includes(q))) return 3;
    return -1;
  };
  return airports
    .map((a) => ({ a, r: rank(a) }))
    .filter(({ r }) => r >= 0)
    .sort(
      (x, y) =>
        x.r - y.r ||
        Number(y.a.main ?? false) - Number(x.a.main ?? false) ||
        SIZE_ORDER[x.a.type] - SIZE_ORDER[y.a.type],
    )
    .slice(0, MAX_RESULTS)
    .map(({ a }) => ({ code: a.code, name: a.name, city: a.city }));
}

export function registerLookupAirport(server: McpServer) {
  server.registerTool(
    "lookupAirport",
    {
      title: "Look up airport",
      description:
        "Find airport codes by city, airport name, alias (e.g. \"NYC\"), or code. Use this when the user names a city instead of an airport code, " +
        "then pass the result's `code` to searchFlights origin/destination. " +
        `Returns { count, results: [{ code, name, city }] } with at most ${MAX_RESULTS} matches, best match first; ` +
        "when a city has several airports, the first is its main (largest) airport.",
      inputSchema: lookupAirportInput,
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const results = lookupAirport(await loadAirports(), query);
      if (results.length === 0) {
        return toolError(`No airport found for "${query}". Try the nearest major city instead, e.g. "Seattle" or "Portland".`);
      }
      return jsonResult({ count: results.length, results });
    },
  );
}
