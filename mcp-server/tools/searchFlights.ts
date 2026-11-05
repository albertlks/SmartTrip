import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { airportNames, findFlights, toFlightResult } from "../lib/flightProviders";
import { jsonResult, ToolFailure, toolError } from "../lib/results";
import type { RunContext } from "../lib/runContext";
import { airportCode, isoDate } from "../lib/schemas";

export const searchFlightsInput = z.object({
  origin: airportCode("origin").describe('Departure airport, 3-letter IATA code (e.g. "HNL"). Use lookupAirport for a city name.'),
  destination: airportCode("destination").describe('Arrival airport, 3-letter IATA code (e.g. "SEA"). Use lookupAirport for a city name.'),
  departDate: isoDate("departDate").describe("Outbound date, YYYY-MM-DD."),
  returnDate: isoDate("returnDate").describe("Return date, YYYY-MM-DD. Must be after departDate."),
});

export function registerSearchFlights(server: McpServer, ctx: RunContext) {
  server.registerTool(
    "searchFlights",
    {
      title: "Search flights",
      description:
        "Find round-trip flights between two airports for the given dates, cheapest first. " +
        "Returns { source, count, airports: { code: name }, results: [{ id, airline, flightNumber, origin, destination, departDate, departTime, " +
        "arriveDate, arriveTime, stops, durationHours, price, redEye, notes }] } for the OUTBOUND flight; " +
        "dates are YYYY-MM-DD and times local HH:MM, redEye appears only when true, notes give layovers, " +
        "and fields the data source lacks are left out. " +
        "Use the id to refer to a flight later. " +
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
        const { source, results } = await findFlights(origin, destination, departDate, returnDate, ctx);
        // Full records stay on the server for presentTrips and the UI; the model gets the compact view.
        for (const record of results) ctx.results.set(record.id, record);
        return jsonResult({ source, count: results.length, airports: airportNames(results), results: results.map(toFlightResult) });
      } catch (err) {
        if (err instanceof ToolFailure) return toolError(err.message);
        throw err;
      }
    },
  );
}
