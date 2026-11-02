import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, availableRoutes, loadFlights } from "./data";
import { providerFor, type Source } from "./providers";
import { ToolFailure } from "./results";
import type { RunContext } from "./runContext";
import { serpapiSearch } from "./serpapi";

export type FlightSource = Source;

export type FlightResult = {
  id: string;
  airline?: string;
  flightNumber?: string;
  originAirport?: string;
  destinationAirport?: string;
  departTime?: string;
  arriveTime?: string;
  stops: number;
  durationHours?: number;
  price: number;
  notes?: string;
};

export class FlightSearchError extends ToolFailure {}

const MAX_RESULTS = 8;
const FIXTURE_DIR = path.join(DATA_DIR, "fixtures");

export async function findFlights(
  origin: string,
  destination: string,
  departDate: string,
  returnDate: string,
  ctx: RunContext,
): Promise<{ source: FlightSource; results: FlightResult[] }> {
  const source = providerFor("FLIGHT");
  const results =
    source === "mock"
      ? await fromMock(origin, destination)
      : source === "fixture"
        ? mapSerpApi(await readFixture(origin, destination, departDate, returnDate))
        : mapSerpApi(await fetchSerpApi(origin, destination, departDate, returnDate, ctx));
  return { source, results };
}

/** Drops undefined fields so results only contain what the data actually had. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

async function fromMock(origin: string, destination: string): Promise<FlightResult[]> {
  const flights = await loadFlights();
  const results = flights
    .filter((f) => f.origin === origin && f.destination === destination)
    .sort((a, b) => a.pricePerPerson - b.pricePerPerson)
    .map((f) =>
      compact({
        id: f.id,
        airline: f.airline,
        flightNumber: f.flightNumber,
        originAirport: f.originAirport,
        destinationAirport: f.destinationAirport,
        departTime: f.departTime,
        arriveTime: f.arriveTime,
        stops: f.stops,
        durationHours: f.durationHours,
        price: f.pricePerPerson,
        notes: f.notes,
      }),
    );
  if (results.length === 0) {
    throw new FlightSearchError(
      `No flights found for ${origin}->${destination}. Routes with flights: ${availableRoutes(flights).join(", ")}.`,
    );
  }
  return results;
}

// ---- SerpApi (Google Flights) ----

const fixtureName = (origin: string, destination: string, departDate: string, returnDate: string) =>
  `serpapi-flights-${origin}-${destination}-${departDate}-${returnDate}.json`;

async function readFixture(origin: string, destination: string, departDate: string, returnDate: string) {
  const file = fixtureName(origin, destination, departDate, returnDate);
  try {
    return JSON.parse(await readFile(path.join(FIXTURE_DIR, file), "utf8")) as SerpApiResponse;
  } catch {
    const saved = await readdir(FIXTURE_DIR).catch(() => [] as string[]);
    const list = saved.filter((f) => f.endsWith(".json"));
    throw new FlightSearchError(
      `No saved fixture for ${origin}->${destination} ${departDate} to ${returnDate} (expected data/fixtures/${file}). ` +
        (list.length ? `Saved fixtures: ${list.join(", ")}.` : "No fixtures are saved yet.") +
        " Search one of those routes and dates, or use FLIGHT_PROVIDER=mock.",
    );
  }
}

async function fetchSerpApi(origin: string, destination: string, departDate: string, returnDate: string, ctx: RunContext) {
  const { response } = await serpapiSearch<SerpApiResponse>(
    "google_flights",
    {
      departure_id: origin,
      arrival_id: destination,
      outbound_date: departDate,
      return_date: returnDate,
      type: "1", // round trip
      adults: "1", // keeps price per person
      currency: "USD",
    },
    ctx,
  );
  return response;
}

// Field names confirmed against data/fixtures/serpapi-flights-HNL-SEA-2026-10-21-2026-10-27.json.
// Every field is optional so anything missing is left out of the results rather than guessed.
type SerpApiAirport = { name?: string; id?: string; time?: string };
type SerpApiSegment = {
  departure_airport?: SerpApiAirport;
  arrival_airport?: SerpApiAirport;
  airline?: string;
  flight_number?: string;
  overnight?: boolean; // this flight lands the next day
  often_delayed_by_over_30_min?: boolean;
};
type SerpApiOption = {
  flights?: SerpApiSegment[];
  layovers?: { id?: string; name?: string; overnight?: boolean }[]; // absent on nonstops
  total_duration?: number;
  price?: number;
  type?: string;
};
type SerpApiResponse = { best_flights?: SerpApiOption[]; other_flights?: SerpApiOption[] };

/** "2026-11-14 07:30" -> "07:30" */
const clockTime = (t?: string) => t?.split(" ")[1];

export function mapSerpApi(response: SerpApiResponse): FlightResult[] {
  const options = [...(response.best_flights ?? []), ...(response.other_flights ?? [])];
  // Each option's type is "Round trip" in the fixture: price is the round-trip total for one adult,
  // so no second call is needed. Times and airports describe the outbound flight only; the return
  // leg's details would need another call with departure_token, which we skip to save quota.
  const results = options
    .filter((o): o is SerpApiOption & { price: number; flights: SerpApiSegment[] } =>
      typeof o.price === "number" && Array.isArray(o.flights) && o.flights.length > 0,
    )
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_RESULTS)
    .map((o, i) => {
      const first = o.flights[0];
      const last = o.flights[o.flights.length - 1];
      const stops = o.layovers?.length ?? o.flights.length - 1;
      const via = o.layovers?.map((l) => l.id).filter(Boolean) ?? [];
      const notes = [
        stops === 0 ? "nonstop" : `${stops} stop${stops > 1 ? "s" : ""}${via.length ? ` via ${via.join(", ")}` : ""}`,
        o.flights.some((s) => s.overnight) ? "arrives next day" : undefined,
        o.layovers?.some((l) => l.overnight) ? "overnight layover" : undefined,
        o.flights.some((s) => s.often_delayed_by_over_30_min) ? "often delayed 30+ min" : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      return compact({
        id: `sp${String(i + 1).padStart(2, "0")}`,
        airline: first.airline,
        flightNumber: first.flight_number,
        originAirport: first.departure_airport?.name,
        destinationAirport: last.arrival_airport?.name,
        departTime: clockTime(first.departure_airport?.time),
        arriveTime: clockTime(last.arrival_airport?.time),
        stops,
        durationHours: typeof o.total_duration === "number" ? Math.round((o.total_duration / 60) * 10) / 10 : undefined,
        price: o.price,
        notes,
      });
    });
  if (results.length === 0) {
    throw new FlightSearchError("The flight search returned no priced flights for that route and dates. Try other dates.");
  }
  return results;
}
