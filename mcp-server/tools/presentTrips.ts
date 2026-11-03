import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { jsonResult, ToolFailure, toolError } from "../lib/results";
import type { RunContext } from "../lib/runContext";
import { buildTrips } from "../lib/trips";

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
        flightId: z.string().trim().min(1).describe("id of a flight from this turn's searchFlights results."),
        hotelId: z.string().trim().min(1).describe("id of a hotel from this turn's searchHotels results, in the same destination."),
        activityIds: z.array(z.string().trim().min(1)).optional().describe("ids of activities from this turn's results. Omit if none."),
        reason: z
          .string()
          .trim()
          .min(1, "reason must not be empty.")
          .max(200, "reason must be one short sentence (200 characters at most).")
          // The cards show the server's totals next to the reason, so a price the model worked out would contradict them.
          .refine((r) => !PRICE_IN_TEXT.test(r), "reason must not contain prices; the cards show the server's totals.")
          .describe("One short sentence on why this package, using facts from tool results. No prices: the cards show the totals."),
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
        "Show the user 1 to 5 complete trip packages, chosen by id from this turn's search results. The server looks up " +
        "each flight and hotel, computes every total (flights x travelers, hotel stay, airport transport), and ranks them: " +
        "your order is kept, except that over-budget trips move after those within budget. Never pass prices. " +
        "Returns { trips: [{ tripId, rank, flightId, hotelId, total, withinBudget }] }; an unknown or mismatched id returns " +
        "an error naming it so you can fix the call. Call it once you have chosen; a later call replaces the trips shown.",
      inputSchema: presentTripsInput,
      annotations: { readOnlyHint: true },
    },
    async ({ budget, travelers, trips: choices }) => {
      try {
        const trips = buildTrips(choices, budget, travelers, ctx);
        ctx.trips = trips;
        return jsonResult({
          trips: trips.map((t) => ({
            tripId: t.tripId,
            rank: t.rank,
            flightId: t.flight.id,
            hotelId: t.hotel.id,
            total: t.totals.total,
            withinBudget: t.withinBudget,
          })),
        });
      } catch (err) {
        if (err instanceof ToolFailure) return toolError(err.message);
        throw err;
      }
    },
  );
}
