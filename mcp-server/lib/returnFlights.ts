import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./data";
import { flightParams, mapSerpApi, type FlightRecord } from "./flightProviders";
import type { Source } from "./providers";
import { ToolFailure } from "./results";
import type { RunContext } from "./runContext";
import { serpapiSearch } from "./serpapi";

// Return flights for one outbound flight, fetched when the user opens a trip (not by the agent). SerpApi lists them
// with a second google_flights search that passes the outbound option's departure_token.

/** A return option. price is SerpApi's round-trip fare per person for the outbound flight paired with this return. */
export type ReturnOption = Omit<FlightRecord, "departureToken" | "cache" | "fetchedAt">;

export type ReturnFlights = {
  flightId: string;
  source: Source;
  /** Cheapest first. */
  options: ReturnOption[];
  cache?: "hit" | "miss";
  fetchedAt?: number;
};

export class ReturnFlightsError extends ToolFailure {}

const FIXTURE_DIR = path.join(DATA_DIR, "fixtures");

/** "f-1444-01" -> 1: the flight's rank in its search, which numbers its saved return fixture. */
const rankOf = (flightId: string) => Number(flightId.split("-").at(-1));

/**
 * The return options for an outbound flight. Mock flights have none (nothing is invented); fixture flights read the
 * saved return response; live flights make one cached SerpApi search. Throws ReturnFlightsError with a readable reason.
 */
export async function findReturnFlights(flight: FlightRecord, returnDate: string, ctx: RunContext): Promise<ReturnFlights> {
  // The return leg flies the other way on the return date; the different route keeps its ids apart from the outbound's.
  const back = { origin: flight.destination, destination: flight.origin, departDate: returnDate, returnDate };
  const done = (response: Parameters<typeof mapSerpApi>[0], extra: Partial<ReturnFlights> = {}): ReturnFlights => ({
    flightId: flight.id,
    source: flight.source,
    options: mapSerpApi(response, back, flight.source).map(({ departureToken: _t, cache: _c, fetchedAt: _f, ...option }) => option),
    ...extra,
  });

  if (flight.source === "mock") {
    throw new ReturnFlightsError("return flights are only available with live flight search (sample flights have none).");
  }
  if (flight.source === "fixture") {
    const name = `serpapi-flights-return-${flight.origin}-${flight.destination}-${flight.departDate}-${returnDate}-${rankOf(flight.id)}.json`;
    const text = await readFile(path.join(FIXTURE_DIR, name), "utf8").catch(() => null);
    if (!text) throw new ReturnFlightsError(`no saved return fixture for this flight (expected data/fixtures/${name}).`);
    return done(JSON.parse(text));
  }
  if (!flight.departureToken) throw new ReturnFlightsError("SerpApi gave no return-flight token for this option.");
  const { response, cache, fetchedAt } = await serpapiSearch<Parameters<typeof mapSerpApi>[0]>(
    "google_flights",
    // The outbound search's parameters plus the token.
    {
      ...flightParams({ origin: flight.origin, destination: flight.destination, departDate: flight.departDate, returnDate }),
      departure_token: flight.departureToken,
    },
    ctx,
  );
  return done(response, { cache, fetchedAt });
}
