import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, availableRoutes, loadFlights } from "./data";

export type FlightSource = "mock" | "fixture" | "serpapi";

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

/** A failure whose message is safe and actionable to show the agent as a toolError. */
export class FlightSearchError extends Error {}

const MAX_RESULTS = 8;
const FIXTURE_DIR = path.join(DATA_DIR, "fixtures");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROVIDERS: FlightSource[] = ["mock", "fixture", "serpapi"];

export function flightProvider(): FlightSource {
  const value = (process.env.FLIGHT_PROVIDER ?? "mock").trim().toLowerCase();
  if (!PROVIDERS.includes(value as FlightSource)) {
    throw new FlightSearchError(`FLIGHT_PROVIDER="${value}" is not valid. Use one of: ${PROVIDERS.join(", ")}.`);
  }
  return value as FlightSource;
}

export async function findFlights(
  origin: string,
  destination: string,
  departDate: string,
  returnDate: string,
): Promise<{ source: FlightSource; results: FlightResult[] }> {
  const source = flightProvider();
  const results =
    source === "mock"
      ? await fromMock(origin, destination)
      : source === "fixture"
        ? mapSerpApi(await readFixture(origin, destination, departDate, returnDate))
        : mapSerpApi(await fetchSerpApi(origin, destination, departDate, returnDate));
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

async function fetchSerpApi(origin: string, destination: string, departDate: string, returnDate: string) {
  const route = `${origin}->${destination} ${departDate}/${returnDate}`;
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    throw new FlightSearchError(
      "FLIGHT_PROVIDER=serpapi but SERPAPI_API_KEY is not set. Add it to .env.local, or use FLIGHT_PROVIDER=fixture.",
    );
  }

  // The free plan allows 250 searches a month, so never search the same route and dates twice within a day.
  const cacheFile = path.join(CACHE_DIR, fixtureName(origin, destination, departDate, returnDate));
  const cached = await readFile(cacheFile, "utf8")
    .then((t) => JSON.parse(t) as { fetchedAt: number; response: SerpApiResponse })
    .catch(() => null);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.error(`[serpapi] ${route}: cache hit`);
    return cached.response;
  }
  console.error(`[serpapi] ${route}: cache miss, calling SerpApi`);

  const url = new URL("https://serpapi.com/search");
  url.search = new URLSearchParams({
    engine: "google_flights",
    departure_id: origin,
    arrival_id: destination,
    outbound_date: departDate,
    return_date: returnDate,
    type: "1", // round trip
    adults: "1", // keeps price per person
    currency: "USD",
    api_key: apiKey,
  }).toString();

  // No retries and no fallback to mock data: every live call spends quota.
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new FlightSearchError(
      `Could not reach SerpApi (${err instanceof Error ? err.message : String(err)}). Check the network, or use FLIGHT_PROVIDER=fixture.`,
    );
  }
  const body = (await res.json().catch(() => ({}))) as SerpApiResponse & { error?: string };
  if (!res.ok || body.error) {
    const detail = body.error ?? `HTTP ${res.status}`;
    const hint =
      res.status === 401
        ? "SERPAPI_API_KEY looks invalid."
        : res.status === 429
          ? "The SerpApi search quota is used up."
          : "SerpApi returned an error.";
    throw new FlightSearchError(`${hint} (${detail}) Use FLIGHT_PROVIDER=fixture for the demo.`);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({ fetchedAt: Date.now(), response: body }));
  return body;
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
