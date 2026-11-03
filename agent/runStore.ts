import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type OpenAI from "openai";
import type { Trip } from "../mcp-server/lib/trips";
import { projectRoot } from "../mcp-server/lib/projectRoot";
import type { TripRequest } from "./recordRequest";
import type { AgentResult, AgentStatus, TraceEntry } from "./runAgent";

/** Everything the results and detail pages need about one run, plus the conversation for a follow-up. */
export type SavedRun = {
  runId: string;
  /** The run this one continues (an answer to its question, or a refine). */
  parentRunId?: string;
  createdAt: string;
  status: AgentStatus | "error";
  /** The user's message for this run. */
  message: string;
  request: TripRequest | null;
  trips: Trip[] | null;
  answer: string | null;
  trace: TraceEntry[];
  usage: AgentResult["usage"];
  /** The conversation without the system prompt, so a follow-up can continue it. Never sent to the browser. */
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  /** A readable reason when status is "error". */
  error?: string;
};

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** SMARTTRIP_RUNS_DIR lets tests use a temporary folder instead of data/runs/. */
const runsDir = () => process.env.SMARTTRIP_RUNS_DIR ?? path.join(projectRoot(), "data/runs");

// Runs are kept in memory for speed and on disk so they survive a restart.
const memory = new Map<string, SavedRun>();

/** Only UUIDs are valid, so an id can never point outside the runs folder. */
export const isRunId = (id: string) => RUN_ID.test(id);

export async function saveRun(run: SavedRun): Promise<void> {
  if (!isRunId(run.runId)) throw new Error(`Invalid run id "${run.runId}".`);
  memory.set(run.runId, run);
  const dir = runsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${run.runId}.json`), JSON.stringify(run));
}

/** The saved run, or null if the id is invalid or unknown. */
export async function getRun(runId: string): Promise<SavedRun | null> {
  if (!isRunId(runId)) return null;
  const cached = memory.get(runId);
  if (cached) return cached;
  const run = await readFile(path.join(runsDir(), `${runId}.json`), "utf8")
    .then((text) => JSON.parse(text) as SavedRun)
    .catch(() => null);
  if (run) memory.set(runId, run);
  return run;
}

/** Forgets the in-memory copies (for tests that simulate a server restart). */
export function clearRunMemory(): void {
  memory.clear();
}

/**
 * What the browser may see: no internal conversation, and no SerpApi departure tokens
 * (the return-flight route reads those on the server).
 */
export function publicRun(run: SavedRun) {
  const { messages: _messages, ...rest } = run;
  return {
    ...rest,
    trips:
      run.trips?.map((t) => {
        const { departureToken: _token, ...flight } = t.flight;
        return { ...t, flight };
      }) ?? null,
  };
}
