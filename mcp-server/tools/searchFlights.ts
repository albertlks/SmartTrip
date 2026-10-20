import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { FlightSearchError, findFlights } from "../lib/flightProviders";
import { jsonResult, toolError } from "../lib/results";
import { airportCode, isoDate } from "../lib/schemas";

export const searchFlightsInput = z.object({
  origin: airportCode("origin").describe('Departure airport, 3-letter IATA code (e.g. "HNL"). Use lookupAirport for a city name.'),
  destination: airportCode("destination").describe('Arrival airport, 3-letter IATA code (e.g. "SEA"). Use lookupAirport for a city name.'),
  departDate: isoDate("departDate").describe("Outbound date, YYYY-MM-DD."),
  returnDate: isoDate("returnDate").describe("Return date, YYYY-MM-DD. Must be after departDate."),
});

export function registerSearchFlights(server: McpServer) {
  server.registerTool(
    "searchFlights",
    {
      title: "Search flights",
      description:
        "Find round-trip flights between two airports for the given dates, cheapest first. " +
        "Returns { source, count, results: [{ id, airline, flightNumber, originAirport, destinationAirport, departTime, arriveTime, stops, durationHours, price, notes }] }; " +
        "times are local HH:MM, and fields the data source lacks are left out. " +
        "price is PER PERSON in USD: pass it as is to checkBudget.flightCost (checkBudget multiplies by travelers). " +
        "If nothing matches, the error says why and what to try instead.",
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

      try {
        const { source, results } = await findFlights(origin, destination, departDate, returnDate);
        return jsonResult({ source, count: results.length, results });
      } catch (err) {
        if (err instanceof FlightSearchError) return toolError(err.message);
        throw err;
      }
    },
  );
}
