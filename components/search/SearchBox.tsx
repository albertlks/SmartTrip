"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { ErrorState } from "@/components/ui/States";
import { RunClientError, startRun, type RunEvent } from "@/lib/runClient";
import { HOME_AIRPORT_KEY, writeStored } from "@/lib/storage";
import { RunProgress } from "./RunProgress";
import { useSearch } from "./SearchProvider";

const MAX_LENGTH = 1000;

type Phase =
  | { kind: "idle" }
  | { kind: "running"; events: RunEvent[]; startedAt: number }
  | { kind: "error"; message: string };

/** Saves the origin the agent understood, so idea cards can fill it in next time. */
async function rememberOrigin(runId: string) {
  try {
    const run = (await (await fetch(`/api/run/${runId}`)).json()) as { request?: { origin?: string | null } };
    if (run.request?.origin) writeStored(HOME_AIRPORT_KEY, run.request.origin);
  } catch {
    // Not remembering the origin is fine.
  }
}

export function SearchBox() {
  const router = useRouter();
  const { text, setText, textareaRef } = useSearch();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Set when the agent asked a question: the next submit answers it in the same conversation.
  const [question, setQuestion] = useState<{ text: string; runId: string } | null>(null);
  const running = phase.kind === "running";

  async function submit() {
    const message = text.trim();
    if (!message) {
      setPhase({ kind: "error", message: "Type a trip request first: where from, where to, when, and your budget." });
      return;
    }
    if (message.length > MAX_LENGTH) {
      setPhase({ kind: "error", message: `Please keep your request under ${MAX_LENGTH} characters (it is ${message.length}).` });
      return;
    }
    setPhase({ kind: "running", events: [], startedAt: Date.now() });
    try {
      const final = await startRun(message, question?.runId ?? null, (event) =>
        setPhase((p) => (p.kind === "running" ? { ...p, events: [...p.events, event] } : p)),
      );
      if (final.type === "done") {
        await rememberOrigin(final.runId);
        router.push(`/results/${final.runId}`);
      } else if (final.type === "needs_input") {
        setQuestion({ text: final.question, runId: final.runId });
        setText("");
        setPhase({ kind: "idle" });
        textareaRef.current?.focus();
      } else if (final.type === "stopped_early") {
        setPhase({ kind: "error", message: "The search stopped before it finished. Try a simpler request, or try again." });
      } else if (final.type === "error") {
        setPhase({ kind: "error", message: final.message });
      }
    } catch (err) {
      const message = err instanceof RunClientError ? err.message : "Something went wrong. Please try again.";
      setPhase({ kind: "error", message });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!running) void submit();
  }

  // Enter searches, like a search bar; Shift+Enter adds a new line.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!running) void submit();
    }
  }

  function startOver() {
    setQuestion(null);
    setText("");
    setPhase({ kind: "idle" });
    textareaRef.current?.focus();
  }

  return (
    <div className="space-y-4">
      {question && (
        <div className="rounded-lg border border-accent/40 bg-accent-soft px-5 py-4" role="status">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-strong">One more detail</p>
          <p className="mt-1 text-base font-medium text-ink">{question.text}</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="rounded-lg border border-line bg-surface p-2 shadow-raised">
        <label htmlFor="trip-request" className="sr-only">
          {question ? "Your answer" : "Describe your trip"}
        </label>
        <Textarea
          id="trip-request"
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          maxLength={MAX_LENGTH + 200}
          rows={3}
          placeholder={question ? "Your answer" : "Where from, where to, when, and your budget"}
          bare
          className="resize-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1">
          <p className="text-xs text-muted">Enter to search · Shift+Enter for a new line</p>
          <div className="flex gap-2">
            {question && !running && (
              <Button variant="quiet" onClick={startOver}>
                Start over
              </Button>
            )}
            <Button type="submit" disabled={running}>
              {running ? "Searching…" : question ? "Reply" : "Search trips"}
            </Button>
          </div>
        </div>
      </form>

      {phase.kind === "running" && <RunProgress events={phase.events} startedAt={phase.startedAt} />}
      {phase.kind === "error" && (
        <ErrorState title="That didn't work" action={<Button variant="secondary" onClick={() => void submit()}>Try again</Button>}>
          {phase.message}
        </ErrorState>
      )}
    </div>
  );
}
