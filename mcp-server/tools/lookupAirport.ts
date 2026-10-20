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
    .describe('City, airport name, or 3-letter code to look up, e.g. "Seattle", "Portland Intl", or "PDX".'),
});

/** Exact code match first, then exact city, then any partial match on code, city, or name. */
export function lookupAirport(airports: Airport[], query: string) {
  const q = query.trim().toLowerCase();
  const rank = (a: Airport) => {
    if (a.code.toLowerCase() === q) return 0;
    if (a.city.toLowerCase() === q) return 1;
    if ([a.code, a.city, a.name].some((field) => field.toLowerCase().includes(q))) return 2;
    return -1;
  };
  return airports
    .map((a) => ({ a, r: rank(a) }))
    .filter(({ r }) => r >= 0)
    .sort((x, y) => x.r - y.r)
    .slice(0, MAX_RESULTS)
    .map(({ a }) => ({ code: a.code, name: a.name, city: a.city }));
}

export function registerLookupAirport(server: McpServer) {
  server.registerTool(
    "lookupAirport",
    {
      title: "Look up airport",
      description:
        "Find airport codes by city, airport name, or code. Use this when the user names a city instead of an airport code, " +
        "then pass the result's `code` to searchFlights origin/destination. " +
        `Returns { count, results: [{ code, name, city }] } with at most ${MAX_RESULTS} matches, best match first.`,
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
