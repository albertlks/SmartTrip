import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { availableRoutes, loadFlights } from "../lib/data";
import { isIsoDate, jsonResult, toolError } from "../lib/results";

const airportCode = (field: string) =>
  z
    .string()
    .regex(/^[A-Za-z]{3}$/, `${field} must be a 3-letter IATA airport code, e.g. "SEA" or "HNL".`)
    .transform((s) => s.toUpperCase());

const isoDate = (field: string) =>
  z.string().refine(isIsoDate, `${field} must be a real date in YYYY-MM-DD form, e.g. "2026-11-14".`);

export const searchFlightsInput = z.object({
  origin: airportCode("origin").describe('Departure airport, 3-letter IATA code (e.g. "HNL").'),
  destination: airportCode("destination").describe('Arrival airport, 3-letter IATA code (e.g. "SEA").'),
  departDate: isoDate("departDate").describe("Outbound date, YYYY-MM-DD."),
  returnDate: isoDate("returnDate").describe("Return date, YYYY-MM-DD. Must be after departDate."),
});

export function registerSearchFlights(server: McpServer) {
  server.registerTool(
    "searchFlights",
    {
      title: "Search flights",
      description:
        "Find flights between two airports for the given dates, cheapest first. " +
        "Returns { count, results: [{ id, airline, price, stops, durationHours, notes }] }; " +
        "price is per person in USD and can be passed straight to checkBudget.flightCost. " +
        "If nothing matches, the error lists the routes that do have flights.",
      inputSchema: searchFlightsInput,
      annotations: { readOnlyHint: true },
    },
    async ({ origin, destination, departDate, returnDate }) => {
      if (origin === destination) {
        return toolError(`origin and destination are both "${origin}". Pick two different airports.`);
      }
      // ISO dates compare correctly as strings.
      if (returnDate <= departDate) {
        return toolError(`returnDate (${returnDate}) must be after departDate (${departDate}).`);
      }

      const flights = await loadFlights();
      const results = flights
        .filter((f) => f.origin === origin && f.destination === destination)
        .sort((a, b) => a.pricePerPerson - b.pricePerPerson)
        .map((f) => ({
          id: f.id,
          airline: f.airline,
          price: f.pricePerPerson,
          stops: f.stops,
          durationHours: f.durationHours,
          notes: f.notes,
        }));

      if (results.length === 0) {
        return toolError(
          `No flights found for ${origin}->${destination}. Routes with flights: ${availableRoutes(flights).join(", ")}.`,
        );
      }
      // The mock data has no dates, so dates are validated but don't filter results yet.
      return jsonResult({ count: results.length, results });
    },
  );
}
