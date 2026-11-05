import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { jsonResult, ToolFailure, toolError } from "../lib/results";
import type { RunContext } from "../lib/runContext";
import { buildTrips, type Trip } from "../lib/trips";
import { tripWeather } from "../lib/weather";

const MAX_TRIPS = 5;
/** "$850", "$ 1,200", "900 USD", "40 dollars" */
const PRICE_IN_TEXT = /\$\s?\d|\d\s?(usd|dollars?)\b/i;

export const presentTripsInput = z.object({
  budget: z
    .number()
    .positive("budget must be greater than 0 (USD).")
    .describe("Total trip budget in USD for all travelers, as recorded with recordRequest."),
  travelers: z
    .number()
    .int("travelers must be a whole number.")
    .min(1, "travelers must be at least 1.")
    .describe("Number of people traveling, as recorded with recordRequest."),
  trips: z
    .array(
      z.object({
        flightId: z.string().trim().min(1).describe("id of a flight from this conversation's searchFlights results, searched for the request's dates."),
        hotelId: z.string().trim().min(1).describe("id of a hotel from this conversation's searchHotels results for the request's dates, in the same destination."),
        activityIds: z.array(z.string().trim().min(1)).optional().describe("ids of activities from this conversation's results. Omit if none."),
        reason: z
          .string()
          .trim()
          .min(1, "reason must not be empty.")
          .max(200, "reason must be one short sentence (200 characters at most).")
          // The cards show the server's totals next to the reason, so a price the model worked out would contradict them.
          .refine((r) => !PRICE_IN_TEXT.test(r), "reason must not contain prices; the cards show the server's totals.")
          .describe(
            'One short sentence on why this package, using facts from tool results, e.g. "Cheapest nonstop, hotel walkable to ' +
              'downtown". No dollar amounts or prices of any kind ("$120", "120 USD", "40 dollars"): the cards show the totals.',
          ),
      }),
    )
    .min(1, "Give at least 1 trip.")
    .max(MAX_TRIPS, `Give at most ${MAX_TRIPS} trips.`)
    .describe(`1 to ${MAX_TRIPS} packages, best match first. Make them different (e.g. lowest total, best location, best balance).`),
});

export function registerPresentTrips(server: McpServer, ctx: RunContext) {
  server.registerTool(
    "presentTrips",
    {
      title: "Present trips",
      description:
        "Show the user 1 to 5 complete trip packages, chosen by id from this conversation's search results. The server looks up " +
        "each flight and hotel, computes every total (flights x travelers, hotel stay, airport transport), and ranks them: " +
        "your order is kept, except that over-budget trips move after those within budget. Never pass prices. " +
        "It also looks up each trip's weather (forecast, or last year's actuals beyond 16 days). Returns { trips: [{ tripId, rank, flightId, hotelId, total, withinBudget, weather }] }; an unknown or mismatched id returns " +
        "an error naming it so you can fix the call. Call it once you have chosen; a later call replaces the trips shown.",
      inputSchema: presentTripsInput,
      annotations: { readOnlyHint: true },
    },
    async ({ budget, travelers, trips: choices }) => {
      try {
        const built = buildTrips(choices, budget, travelers, ctx);
        // One lookup per destination and dates, in parallel. A weather outage never fails the call.
        const deps = { today: ctx.today ?? new Date().toLocaleDateString("en-CA") };
        const lookups = new Map<string, ReturnType<typeof tripWeather>>();
        const weatherFor = (t: Trip) => {
          const key = `${t.destination}|${t.flight.departDate}|${t.flight.returnDate}`;
          if (!lookups.has(key)) lookups.set(key, tripWeather(t.destination, t.flight.departDate, t.flight.returnDate, deps));
          return lookups.get(key)!;
        };
        const trips = await Promise.all(built.map(async (t) => ({ ...t, weather: await weatherFor(t) })));
        ctx.trips = trips;
        return jsonResult({
          trips: trips.map((t) => ({
            tripId: t.tripId,
            rank: t.rank,
            flightId: t.flight.id,
            hotelId: t.hotel.id,
            total: t.totals.total,
            withinBudget: t.withinBudget,
            weather: t.weather && "summary" in t.weather ? t.weather.summary : "not found",
          })),
        });
      } catch (err) {
        if (err instanceof ToolFailure) return toolError(err.message);
        throw err;
      }
    },
  );
}
