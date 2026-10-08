import { readFile } from "node:fs/promises";
import path from "node:path";

// Mock data lives in the repo-root data/ folder.
const DATA_DIR = path.resolve(import.meta.dirname, "../../data");

export type Flight = {
  id: string;
  origin: string;
  destination: string;
  airline: string;
  pricePerPerson: number;
  stops: number;
  durationHours: number;
  notes: string;
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

/** Distinct "ORIGIN->DEST" routes, used to tell the agent what it can search. */
export function availableRoutes(flights: Flight[]): string[] {
  return [...new Set(flights.map((f) => `${f.origin}->${f.destination}`))].sort();
}
