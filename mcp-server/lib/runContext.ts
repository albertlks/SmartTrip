import { randomUUID } from "node:crypto";

/**
 * State shared by the tools of one agent run: one per run in the web app and CLI,
 * one per process for the stdio server.
 */
export type RunContext = {
  runId: string;
  /** Full tool results by id, so presentTrips can look up what this run's searches returned. */
  results: Map<string, unknown>;
  /** Live SerpApi calls made in this run (cache hits don't count). */
  serpapiCalls: number;
  maxSerpapiCalls: number;
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
