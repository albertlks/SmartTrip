import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { describeLlmError, llmProvider } from "./llm";
import { runAgent, type AgentDeps, type AgentEvent } from "./runAgent";
import { getRun, saveRun, type SavedRun } from "./runStore";

export const MAX_MESSAGE_LENGTH = 1000;

/** One line of the POST /api/run stream (newline-delimited JSON). */
export type RunEvent =
  | { type: "run"; runId: string; parentRunId?: string }
  | { type: "tool_call"; step: number; name: string }
  | { type: "tool_result"; step: number; name: string; isError: boolean; ms: number }
  | { type: "done" | "stopped_early"; runId: string }
  | { type: "needs_input"; runId: string; question: string }
  | { type: "error"; runId: string; message: string };

/** Bad input from the browser; the route answers HTTP 400 with this message. */
export class RunInputError extends Error {}

export type PreparedRun = { message: string; parent: SavedRun | null };

/** Checks the request body before any LLM call. Throws RunInputError with a readable message. */
export async function prepareRun(body: unknown): Promise<PreparedRun> {
  const { message, parentRunId } = (body ?? {}) as { message?: unknown; parentRunId?: unknown };
  if (typeof message !== "string" || !message.trim()) {
    throw new RunInputError("Type a trip request first, for example where from, where to, when, and your budget.");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new RunInputError(`Your request is ${message.length} characters; please keep it under ${MAX_MESSAGE_LENGTH}.`);
  }
  if (parentRunId === undefined || parentRunId === null) return { message: message.trim(), parent: null };
  const parent = typeof parentRunId === "string" ? await getRun(parentRunId) : null;
  if (!parent) throw new RunInputError("The earlier search could not be found. Start a new search.");
  return { message: message.trim(), parent };
}

const GENERIC_ERROR = "Something went wrong while planning your trip. Please try again.";

/**
 * Runs the agent and streams its progress as newline-delimited JSON, ending with the run's status.
 * The run is saved when it finishes, including when it fails, so the results page can load it by id.
 */
export function runStream({ message, parent }: PreparedRun, deps: AgentDeps = {}): ReadableStream<Uint8Array> {
  const runId = randomUUID();
  const encoder = new TextEncoder();
  const userMessage: OpenAI.Chat.ChatCompletionMessageParam = { role: "user", content: message };
  const messages = [...(parent?.messages ?? []), userMessage];

  return new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: RunEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser went away; keep running so the run is still saved.
          open = false;
        }
      };
      const onEvent = (event: AgentEvent) => {
        if (event.type === "tool_call") send({ type: "tool_call", step: event.step, name: event.name });
        if (event.type === "tool_result") {
          const { step, name, isError, ms } = event.entry;
          send({ type: "tool_result", step, name, isError, ms });
        }
      };
      const base = { runId, parentRunId: parent?.runId, createdAt: new Date().toISOString(), message };

      send({ type: "run", runId, ...(parent ? { parentRunId: parent.runId } : {}) });
      try {
        const result = await runAgent(messages, onEvent, deps);
        await saveRun({
          ...base,
          status: result.status,
          request: result.request,
          trips: result.trips,
          answer: result.answer,
          trace: result.trace,
          usage: result.usage,
          messages: result.messages,
        });
        send(
          result.status === "needs_input"
            ? { type: "needs_input", runId, question: result.answer ?? "" }
            : { type: result.status, runId },
        );
      } catch (err) {
        const readable = describeLlmError(err, llmProvider());
        // Unknown errors go to the server log only; the browser gets a readable message, never a stack trace.
        if (!readable) console.error(`[run ${runId}]`, err);
        const error = readable ?? GENERIC_ERROR;
        await saveRun({
          ...base,
          status: "error",
          request: null,
          trips: null,
          answer: null,
          trace: [],
          usage: { llmCalls: 0, promptTokens: 0, completionTokens: 0 },
          messages,
          error,
        }).catch((saveErr) => console.error(`[run ${runId}] could not save`, saveErr));
        send({ type: "error", runId, message: error });
      } finally {
        if (open) controller.close();
      }
    },
  });
}
