import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, availableRoutes, loadFlights, type Flight } from "./data";
import { demoOffline, providerFor, type Source } from "./providers";
import { addDays, ToolFailure } from "./results";
import type { RunContext } from "./runContext";
import { serpapiSearch } from "./serpapi";

export type FlightSource = Source;

export type FlightSegment = {
  airline?: string;
  flightNumber?: string;
  from: string;
  to: string;
  /** Local "YYYY-MM-DD HH:MM". */
  departAt?: string;
  arriveAt?: string;
  durationMinutes?: number;
};

export type Layover = { airport: string; name?: string; minutes?: number; overnight?: boolean };

/**
 * Everything known about one outbound flight option. Saved in the run context so presentTrips and
 * the UI can use it; the model only sees the smaller FlightResult.
 */
export type FlightRecord = {
  kind: "flight";
  id: string;
  source: FlightSource;
  /** Prices are round-trip fares per person, but times and segments describe the outbound flight only. */
  tripType: "round trip";
  origin: string;
  originAirport?: string;
  destination: string;
  destinationAirport?: string;
  departDate: string;
  /** The return date this round-trip fare was searched for. */
  returnDate: string;
  departTime?: string;
  arriveDate?: string;
  arriveTime?: string;
  durationMinutes?: number;
  stops: number;
  /** Empty when the data source doesn't list segments (mock flights with stops). */
  segments: FlightSegment[];
  layovers: Layover[];
  /** Departs 21:00 to 04:59 local and lands the next day. */
  redEye: boolean;
  airline?: string;
  /** All segments' flight numbers, e.g. "DL 471 / DL 12". */
  flightNumber?: string;
  price: number;
  notes?: string;
  /** SerpApi's token for fetching this option's return flights. Never sent to the model. */
  departureToken?: string;
  /** For SerpApi data: whether it came from the cache, and when it was fetched (ms since epoch). */
  cache?: "hit" | "miss";
  fetchedAt?: number;
};

/** The compact view of a flight that the model sees. Airport names are listed once per search, not per flight. */
export type FlightResult = Pick<
  FlightRecord,
  "id" | "airline" | "flightNumber" | "origin" | "destination" | "departDate" | "departTime" | "arriveDate" | "arriveTime" | "stops" | "price" | "notes"
> & { durationHours?: number; redEye?: true };

export class FlightSearchError extends ToolFailure {}

export type FlightSearch = { origin: string; destination: string; departDate: string; returnDate: string };
type Search = FlightSearch;

const MAX_RESULTS = 8;
const FIXTURE_DIR = path.join(DATA_DIR, "fixtures");

export async function findFlights(
  origin: string,
  destination: string,
  departDate: string,
  returnDate: string,
  ctx: RunContext,
): Promise<{ source: FlightSource; results: FlightRecord[] }> {
  const search = { origin, destination, departDate, returnDate };
  const source = providerFor("FLIGHT");
  if (source === "mock") return { source, results: await fromMock(search) };
  if (source === "fixture") {
    const saved = await readFixture(search).catch((err) => {
      // The offline demo switch uses sample data when this route has no saved search.
      if (demoOffline()) return null;
      throw err;
    });
    if (!saved) return { source: "mock", results: await fromMock(search) };
    return { source, results: mapSerpApi(saved, search, "fixture") };
  }
  return { source, results: await fromSerpApi(search, ctx) };
}

export function toFlightResult(r: FlightRecord): FlightResult {
  return compact({
    id: r.id,
    airline: r.airline,
    flightNumber: r.flightNumber,
    origin: r.origin,
    destination: r.destination,
    departDate: r.departDate,
    departTime: r.departTime,
    arriveDate: r.arriveDate,
    arriveTime: r.arriveTime,
    stops: r.stops,
    durationHours: r.durationMinutes === undefined ? undefined : Math.round((r.durationMinutes / 60) * 10) / 10,
    price: r.price,
    // Only flagged when true, to keep the output small.
    redEye: r.redEye ? (true as const) : undefined,
    notes: r.notes,
  });
}

/** Airport code -> name for every airport in these results, so each flight needn't repeat the names. */
export function airportNames(records: FlightRecord[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const r of records) {
    if (r.originAirport) names[r.origin] = r.originAirport;
    if (r.destinationAirport) names[r.destination] = r.destinationAirport;
  }
  return names;
}

/** Drops undefined fields so results only contain what the data actually had. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** 126 -> "2h06" */
export const formatMinutes = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

/** Red-eye: leaves between 21:00 and 04:59 local time and lands on a later date. */
export function isRedEye(departTime: string | undefined, departDate: string, arriveDate: string | undefined): boolean {
  if (!departTime || !arriveDate || arriveDate <= departDate) return false;
  const hour = Number(departTime.slice(0, 2));
  return hour >= 21 || hour < 5;
}

async function fromMock(search: Search): Promise<FlightRecord[]> {
  const flights = await loadFlights();
  const results = flights
    .filter((f) => f.origin === search.origin && f.destination === search.destination)
    .sort((a, b) => a.pricePerPerson - b.pricePerPerson)
    .map((f) => mockRecord(f, search));
  if (results.length === 0) {
    throw new FlightSearchError(
      `No flights found for ${search.origin}->${search.destination}. Routes with flights: ${availableRoutes(flights).join(", ")}.`,
    );
  }
  return results;
}

/** Mock flights have times but no dates: they leave on the searched date, and land the next day when the clock wraps. */
function mockRecord(f: Flight, { departDate, returnDate }: Search): FlightRecord {
  const wraps = f.departTime && f.arriveTime && f.arriveTime < f.departTime ? 1 : 0;
  const arriveDate = f.arriveTime ? addDays(departDate, f.arriveDayOffset ?? wraps) : undefined;
  const departAt = f.departTime && `${departDate} ${f.departTime}`;
  const arriveAt = arriveDate && f.arriveTime && `${arriveDate} ${f.arriveTime}`;
  const durationMinutes = Math.round(f.durationHours * 60);
  return compact({
    kind: "flight" as const,
    id: f.id,
    source: "mock" as const,
    tripType: "round trip" as const,
    origin: f.origin,
    originAirport: f.originAirport,
    destination: f.destination,
    destinationAirport: f.destinationAirport,
    departDate,
    returnDate,
    departTime: f.departTime,
    arriveDate,
    arriveTime: f.arriveTime,
    durationMinutes,
    stops: f.stops,
    // Mock data only knows the segment of a nonstop flight; connections are described in notes.
    segments:
      f.stops === 0
        ? [compact({ airline: f.airline, flightNumber: f.flightNumber, from: f.origin, to: f.destination, departAt, arriveAt, durationMinutes })]
        : [],
    layovers: [],
    redEye: isRedEye(f.departTime, departDate, arriveDate),
    airline: f.airline,
    flightNumber: f.flightNumber,
    price: f.pricePerPerson,
    notes: f.notes,
  });
}

// ---- SerpApi (Google Flights) ----

const fixtureName = ({ origin, destination, departDate, returnDate }: Search) =>
  `serpapi-flights-${origin}-${destination}-${departDate}-${returnDate}.json`;

async function readFixture(search: Search) {
  const file = fixtureName(search);
  try {
    return JSON.parse(await readFile(path.join(FIXTURE_DIR, file), "utf8")) as SerpApiResponse;
  } catch {
    const saved = await readdir(FIXTURE_DIR).catch(() => [] as string[]);
    const list = saved.filter((f) => f.endsWith(".json"));
    throw new FlightSearchError(
      `No saved fixture for ${search.origin}->${search.destination} ${search.departDate} to ${search.returnDate} ` +
        `(expected data/fixtures/${file}). ` +
        (list.length ? `Saved fixtures: ${list.join(", ")}.` : "No fixtures are saved yet.") +
        " Search one of those routes and dates, or use FLIGHT_PROVIDER=mock.",
    );
  }
}

/** The google_flights parameters for a round-trip search. demo:check warms these, so they must stay the app's own. */
export function flightParams(search: Search): Record<string, string> {
  return {
    departure_id: search.origin,
    arrival_id: search.destination,
    outbound_date: search.departDate,
    return_date: search.returnDate,
    type: "1", // round trip
    adults: "1", // keeps price per person
    currency: "USD",
  };
}

async function fromSerpApi(search: Search, ctx: RunContext): Promise<FlightRecord[]> {
  const { response, cache, fetchedAt } = await serpapiSearch<SerpApiResponse>("google_flights", flightParams(search), ctx);
  return mapSerpApi(response, search, "serpapi").map((r) => ({ ...r, cache, fetchedAt }));
}

// Field names confirmed against data/fixtures/serpapi-flights-HNL-SEA-2026-10-21-2026-10-27.json.
// Every field is optional so anything missing is left out of the results rather than guessed.
type SerpApiAirport = { name?: string; id?: string; time?: string };
type SerpApiSegment = {
  departure_airport?: SerpApiAirport;
  arrival_airport?: SerpApiAirport;
  duration?: number;
  airline?: string;
  flight_number?: string;
  overnight?: boolean; // this flight lands the next day
  often_delayed_by_over_30_min?: boolean;
};
type SerpApiOption = {
  flights?: SerpApiSegment[];
  layovers?: { id?: string; name?: string; duration?: number; overnight?: boolean }[]; // absent on nonstops
  total_duration?: number;
  price?: number;
  type?: string;
  departure_token?: string;
};
type SerpApiResponse = { best_flights?: SerpApiOption[]; other_flights?: SerpApiOption[] };

/** "2026-11-14 07:30" -> ["2026-11-14", "07:30"] */
const splitTime = (t?: string) => (t ? (t.split(" ") as [string, string]) : [undefined, undefined]);

/**
 * Ids look like "f-3a9c-01": a fingerprint of the search, then the rank. The same search always gives the
 * same ids, and two searches in one run (two destinations) never share one.
 */
const idPrefix = ({ origin, destination, departDate, returnDate }: Search) =>
  `f-${createHash("sha1").update(`${origin}|${destination}|${departDate}|${returnDate}`).digest("hex").slice(0, 4)}`;

export function mapSerpApi(response: SerpApiResponse, search: Search, source: FlightSource): FlightRecord[] {
  const options = [...(response.best_flights ?? []), ...(response.other_flights ?? [])];
  const prefix = idPrefix(search);
  // Each option's type is "Round trip" in the fixture: price is the round-trip total for one adult,
  // so no second call is needed. Times and airports describe the outbound flight only; the return
  // leg's details need another call with departure_token, made only when the user opens a trip.
  const results = options
    .filter((o): o is SerpApiOption & { price: number; flights: SerpApiSegment[] } =>
      typeof o.price === "number" && Array.isArray(o.flights) && o.flights.length > 0,
    )
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_RESULTS)
    .map((o, i): FlightRecord => {
      const first = o.flights[0];
      const last = o.flights[o.flights.length - 1];
      const [departDate, departTime] = splitTime(first.departure_airport?.time);
      const [arriveDate, arriveTime] = splitTime(last.arrival_airport?.time);
      const layovers = (o.layovers ?? []).map((l) =>
        compact({ airport: l.id ?? "?", name: l.name, minutes: l.duration, overnight: l.overnight }),
      );
      const stops = o.layovers?.length ?? o.flights.length - 1;
      const via = layovers.map((l) => (l.minutes === undefined ? l.airport : `${l.airport} (${formatMinutes(l.minutes)})`));
      const notes = [
        stops === 0 ? "nonstop" : `${stops} stop${stops > 1 ? "s" : ""}${via.length ? ` via ${via.join(", ")}` : ""}`,
        o.flights.some((s) => s.overnight) ? "arrives next day" : undefined,
        o.layovers?.some((l) => l.overnight) ? "overnight layover" : undefined,
        o.flights.some((s) => s.often_delayed_by_over_30_min) ? "often delayed 30+ min" : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      const flightNumbers = o.flights.map((s) => s.flight_number).filter(Boolean);
      return compact({
        kind: "flight" as const,
        id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
        source,
        tripType: "round trip" as const,
        origin: first.departure_airport?.id ?? search.origin,
        originAirport: first.departure_airport?.name,
        destination: last.arrival_airport?.id ?? search.destination,
        destinationAirport: last.arrival_airport?.name,
        departDate: departDate ?? search.departDate,
        returnDate: search.returnDate,
        departTime,
        arriveDate,
        arriveTime,
        durationMinutes: o.total_duration,
        stops,
        segments: o.flights.map((s) =>
          compact({
            airline: s.airline,
            flightNumber: s.flight_number,
            from: s.departure_airport?.id ?? "?",
            to: s.arrival_airport?.id ?? "?",
            departAt: s.departure_airport?.time,
            arriveAt: s.arrival_airport?.time,
            durationMinutes: s.duration,
          }),
        ),
        layovers,
        redEye: isRedEye(departTime, departDate ?? search.departDate, arriveDate),
        airline: first.airline,
        flightNumber: flightNumbers.length ? flightNumbers.join(" / ") : undefined,
        price: o.price,
        notes,
        departureToken: o.departure_token,
      });
    });
  if (results.length === 0) {
    throw new FlightSearchError("The flight search returned no priced flights for that route and dates. Try other dates.");
  }
  return results;
}
