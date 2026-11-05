import { readFile } from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = path.resolve(import.meta.dirname, "../../data");

export type Flight = {
  id: string;
  origin: string;
  destination: string;
  airline: string;
  flightNumber?: string;
  originAirport?: string;
  destinationAirport?: string;
  departTime?: string;
  arriveTime?: string;
  pricePerPerson: number;
  stops: number;
  durationHours: number;
  /** Days after departure that the flight lands, when the clock times alone don't show it (crossing the date line). */
  arriveDayOffset?: number;
  notes?: string;
};

/** Built by scripts/build-airports.ts from OurAirports. */
export type Airport = {
  code: string;
  name: string;
  city: string;
  region: string;
  country: string;
  type: "large" | "medium" | "small";
  latitude: number;
  longitude: number;
  keywords?: string[];
  /** Set on a city's main airport where two large airports would otherwise tie, e.g. ORD over MDW. */
  main?: boolean;
};

export type Hotel = {
  id: string;
  destination: string;
  name: string;
  city: string;
  area: string;
  tier: "budget" | "mid" | "upscale" | "luxury";
  pricePerNight: number;
  rating: number;
  milesToAirport: number;
  milesToDowntown: number;
  notes: string;
};

/** One hotel result for a stay, saved in the run context so presentTrips can look it up by id. */
export type HotelRecord = Hotel & {
  kind: "hotel";
  source: "mock";
  checkIn: string;
  checkOut: string;
  nights: number;
  stayTotal: number;
};

// Files are read once per process; restart the server to pick up edits.
const cache = new Map<string, Promise<unknown>>();

async function loadJson<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    const load = readFile(path.join(DATA_DIR, file), "utf8").then((text) => JSON.parse(text));
    // Don't cache a failed read, so the next call retries.
    load.catch(() => cache.delete(file));
    cache.set(file, load);
  }
  return cache.get(file) as Promise<T>;
}

export const loadFlights = () => loadJson<Flight[]>("flights.json");
export const loadAirports = () => loadJson<Airport[]>("airports.json");
export const loadHotels = () => loadJson<Hotel[]>("hotels.json");

/** The airport with this IATA code, or undefined. For tools that need coordinates. */
export async function getAirport(code: string): Promise<Airport | undefined> {
  const upper = code.toUpperCase();
  return (await loadAirports()).find((a) => a.code === upper);
}

export function availableRoutes(flights: Flight[]): string[] {
  return [...new Set(flights.map((f) => `${f.origin}->${f.destination}`))].sort();
}
