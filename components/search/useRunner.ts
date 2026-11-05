"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RunClientError, startRun, type RunEvent } from "@/lib/runClient";

export type RunnerPhase =
  | { kind: "idle" }
  | { kind: "running"; events: RunEvent[]; startedAt: number }
  | { kind: "error"; message: string };

/** The agent's one question, and the run to continue when the user answers it. */
export type Question = { text: string; runId: string };

/**
 * Runs a search and follows it: progress events while it works, its question if it asks one, a readable error
 * if it fails, and the results page when it is done. Shared by the landing page and the results page.
 */
export function useRunner({ beforeNavigate }: { beforeNavigate?: (runId: string) => Promise<void> } = {}) {
  const router = useRouter();
  const [phase, setPhase] = useState<RunnerPhase>({ kind: "idle" });
  const [question, setQuestion] = useState<Question | null>(null);

  /** Starts a run (continuing parentRunId's conversation when given). Resolves with how it ended. */
  async function run(message: string, parentRunId: string | null): Promise<RunEvent["type"] | null> {
    setPhase({ kind: "running", events: [], startedAt: Date.now() });
    try {
      const final = await startRun(message, parentRunId, (event) =>
        setPhase((p) => (p.kind === "running" ? { ...p, events: [...p.events, event] } : p)),
      );
      if (final.type === "done") {
        await beforeNavigate?.(final.runId);
        // Stays "running" until the results page replaces this one.
        router.push(`/results/${final.runId}`);
      } else if (final.type === "needs_input") {
        setQuestion({ text: final.question, runId: final.runId });
        setPhase({ kind: "idle" });
      } else if (final.type === "stopped_early") {
        setPhase({ kind: "error", message: "The search stopped before it finished. Try a simpler request, or try again." });
      } else if (final.type === "error") {
        setPhase({ kind: "error", message: final.message });
      }
      return final.type;
    } catch (err) {
      const message = err instanceof RunClientError ? err.message : "Something went wrong. Please try again.";
      setPhase({ kind: "error", message });
      return null;
    }
  }

  return {
    phase,
    running: phase.kind === "running",
    question,
    run,
    /** Shows a message without starting a run (e.g. an empty request). */
    fail: (message: string) => setPhase({ kind: "error", message }),
    /** Forgets the question and any error. */
    reset: () => {
      setQuestion(null);
      setPhase({ kind: "idle" });
    },
  };
}
