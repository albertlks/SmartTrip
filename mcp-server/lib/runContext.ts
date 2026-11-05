import { randomUUID } from "node:crypto";
import type { HotelRecord } from "./data";
import type { FlightRecord } from "./flightProviders";
import type { Trip } from "./trips";

/** A full search result saved for this run. Activities join this union in a later issue. */
export type StoredResult = FlightRecord | HotelRecord;

/**
 * State shared by the tools of one agent run: one per run in the web app and CLI,
 * one per process for the stdio server.
 */
export type RunContext = {
  runId: string;
  /** Full tool results by id, so presentTrips can look up what this run's searches returned. */
  results: Map<string, StoredResult>;
  /** What the user asked for, set by runAgent when recordRequest succeeds; presentTrips checks against it. */
  request?: { travelers: number; budget: number | null; departDate: string | null; returnDate: string | null };
  /** The trips from the last successful presentTrips call. */
  trips?: Trip[];
  /** Live SerpApi calls made in this run (cache hits don't count). */
  serpapiCalls: number;
  maxSerpapiCalls: number;
  /** "Today" (YYYY-MM-DD, local) for weather's forecast/last-year split; set by runAgent. Defaults to the real date. */
  today?: string;
};

const DEFAULT_MAX_SERPAPI_CALLS = 12;

export function newRunContext(runId: string = randomUUID()): RunContext {
  const max = Number(process.env.SERPAPI_MAX_CALLS_PER_RUN);
  return {
    runId,
    results: new Map(),
    serpapiCalls: 0,
    maxSerpapiCalls: Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_SERPAPI_CALLS,
  };
}
