import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { loadHotels, type Hotel, type HotelRecord } from "../lib/data";
import { daysBetween, jsonResult, roundMoney, toolError } from "../lib/results";
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
});

export function searchHotels(hotels: Hotel[], destination: string, nights: number, maxPricePerNight?: number) {
  return hotels
    .filter((h) => h.destination === destination)
    .filter((h) => maxPricePerNight === undefined || h.pricePerNight <= maxPricePerNight)
    .sort((a, b) => a.pricePerNight - b.pricePerNight)
    .map((h) => ({
      id: h.id,
      name: h.name,
      city: h.city,
      area: h.area,
      tier: h.tier,
      pricePerNight: h.pricePerNight,
      stayTotal: roundMoney(h.pricePerNight * nights),
      rating: h.rating,
      milesToAirport: h.milesToAirport,
      milesToDowntown: h.milesToDowntown,
      notes: h.notes,
    }));
}

export function registerSearchHotels(server: McpServer, ctx: RunContext) {
  server.registerTool(
    "searchHotels",
    {
      title: "Search hotels",
      description:
        "Find hotels in a destination for the given dates, cheapest first, optionally capped by nightly price. " +
        "Returns { nights, count, results: [{ id, name, city, area, tier, pricePerNight, stayTotal, rating, milesToAirport, milesToDowntown, notes }] }. " +
        "Pass pricePerNight to checkBudget.hotelCostPerNight, nights to checkBudget.nights, and milesToAirport to estimateTransport. " +
        "Prices are per room per night in USD.",
      inputSchema: searchHotelsInput,
      annotations: { readOnlyHint: true },
    },
    async ({ destination, checkIn, checkOut, maxPricePerNight }) => {
      const nights = daysBetween(checkIn, checkOut);
      if (nights < 1) {
        return toolError(`checkOut (${checkOut}) must be after checkIn (${checkIn}).`);
      }

      const hotels = await loadHotels();
      // The mock data has no availability by date, so dates set nights but don't filter results.
      const results = searchHotels(hotels, destination, nights, maxPricePerNight);
      if (results.length === 0) {
        const destinations = [...new Set(hotels.map((h) => h.destination))].sort().join(", ");
        const why = hotels.some((h) => h.destination === destination)
          ? `No ${destination} hotels at or under $${maxPricePerNight}/night. Raise or drop maxPricePerNight.`
          : `No hotels in ${destination}.`;
        return toolError(`${why} Destinations with hotels: ${destinations}.`);
      }
      // Saved for presentTrips, which looks hotels up by id and uses this stay's nights and total.
      for (const r of results) {
        const hotel = hotels.find((h) => h.id === r.id)!;
        const record: HotelRecord = { ...hotel, kind: "hotel", source: "mock", checkIn, checkOut, nights, stayTotal: r.stayTotal };
        ctx.results.set(r.id, record);
      }
      return jsonResult({ nights, count: results.length, results });
    },
  );
}
