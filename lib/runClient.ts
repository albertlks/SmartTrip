import type { RunEvent } from "@/agent/runService";

export type { RunEvent };

/** A failure with a message that is safe to show as is. */
export class RunClientError extends Error {}

const TERMINAL = new Set(["done", "needs_input", "stopped_early", "error"]);

/**
 * Starts a run with POST /api/run and calls onEvent for each line of its stream.
 * Resolves with the final event (done, needs_input, stopped_early, or error). Throws RunClientError.
 */
export async function startRun(
  message: string,
  parentRunId: string | null,
  onEvent: (event: RunEvent) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<RunEvent> {
  let res: Response;
  try {
    res = await fetchImpl("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parentRunId ? { message, parentRunId } : { message }),
    });
  } catch {
    throw new RunClientError("Couldn't reach SmartTrip. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new RunClientError(body.error ?? "SmartTrip couldn't start the search. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last: RunEvent | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as RunEvent;
    last = event;
    onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Chunks can end mid-line; keep the unfinished part for the next chunk.
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(buffer + decoder.decode());
  } catch {
    throw new RunClientError("The connection dropped during the search. Please try again.");
  }
  const final = last as RunEvent | null;
  if (!final || !TERMINAL.has(final.type)) {
    throw new RunClientError("The search ended without a result. Please try again.");
  }
  return final;
}
