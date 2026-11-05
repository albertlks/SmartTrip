import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { HotelRecord } from "../lib/data";
import { findHotels } from "../lib/hotelProviders";
import { daysBetween, jsonResult, toolError, ToolFailure } from "../lib/results";
import type { RunContext } from "../lib/runContext";
import { airportCode, isoDate } from "../lib/schemas";

export const searchHotelsInput = z.object({
  destination: airportCode("destination").describe('City to stay in, as its 3-letter airport code (e.g. "SEA").'),
  checkIn: isoDate("checkIn").describe("Check-in date, YYYY-MM-DD (usually the flight's departDate)."),
  checkOut: isoDate("checkOut").describe("Check-out date, YYYY-MM-DD. Must be after checkIn (usually the returnDate)."),
  maxPricePerNight: z
    .number()
    .positive("maxPricePerNight must be greater than 0 (USD).")
    .optional()
    .describe("Only return hotels at or under this nightly price in USD. Omit for no limit."),
  travelers: z.number().int().min(1).max(9).optional().describe("Number of guests, as recorded with recordRequest. Default 1."),
  sort: z.enum(["price", "rating"]).optional().describe('"price" (cheapest first, the default) or "rating" (best rated first).'),
});

/** What the model sees: the record without bookkeeping fields (kind, dates, coordinates, cache). */
function forModel(r: HotelRecord) {
  const { kind: _k, checkIn: _i, checkOut: _o, nights: _n, latitude: _lat, longitude: _lon, cache: _c, fetchedAt: _f, destination: _d, ...rest } = r;
  return rest;
}

export function registerSearchHotels(server: McpServer, ctx: RunContext) {
  server.registerTool(
    "searchHotels",
    {
      title: "Search hotels",
      description:
        "Find hotels in a destination for the given dates, cheapest first (or best rated with sort), optionally capped by nightly price. " +
        "Returns { source, nights, count, results: [{ id, name, city, area?, tier?, pricePerNight, stayTotal, rating?, reviews?, milesToAirport?, milesToDowntown?, notes? }] }, at most 8. " +
        "Prices are per room per night in USD, and rooms are not multiplied for larger groups. For live hotels milesToAirport is a " +
        "straight-line distance computed from the hotel's location, and there is no milesToDowntown; fields a hotel doesn't have are left out. " +
        "Live results skip listings with fewer than 10 reviews.",
      inputSchema: searchHotelsInput,
      annotations: { readOnlyHint: true },
    },
    async ({ destination, checkIn, checkOut, maxPricePerNight, travelers, sort }) => {
      const nights = daysBetween(checkIn, checkOut);
      if (nights < 1) {
        return toolError(`checkOut (${checkOut}) must be after checkIn (${checkIn}).`);
      }
      try {
        const { source, results } = await findHotels(
          { destination, checkIn, checkOut, maxPricePerNight, travelers: travelers ?? 1, sort: sort ?? "price" },
          ctx,
        );
        if (results.length === 0) {
          return toolError(`No ${destination} hotels found for ${checkIn} to ${checkOut}${maxPricePerNight ? ` at or under $${maxPricePerNight}/night` : ""}. Raise or drop maxPricePerNight.`);
        }
        // Saved for presentTrips, which looks hotels up by id and uses this stay's nights and total.
        for (const r of results) ctx.results.set(r.id, r);
        return jsonResult({ source, nights, count: results.length, results: results.map(forModel) });
      } catch (err) {
        if (err instanceof ToolFailure) return toolError(err.message);
        throw err;
      }
    },
  );
}
