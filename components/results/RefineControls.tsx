"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { TripRequest } from "@/agent/recordRequest";
import { RunProgress } from "@/components/search/RunProgress";
import { useRunner } from "@/components/search/useRunner";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { Input } from "@/components/ui/Input";
import { ErrorState } from "@/components/ui/States";
import { editMessage, editStart, toChips, type ChipField, type RequestEdit } from "@/lib/requestChips";
import { ChipEditor } from "./ChipEditor";

const MAX_LENGTH = 1000;
const EDITOR_ID = "chip-editor";

/**
 * The results page's controls: the request as editable chips, a refine box, and the agent's question when it
 * asked one. Every change is a new run that continues this run's conversation. Only one search runs at a time,
 * and the rows (children) dim while it does.
 */
export function RefineControls({
  runId,
  request,
  question: savedQuestion,
  children,
}: {
  runId: string;
  request: TripRequest;
  /** The question this run stopped on, if any. */
  question: string | null;
  children?: ReactNode;
}) {
  const runner = useRunner();
  const [editing, setEditing] = useState<ChipField | null>(null);
  const [text, setText] = useState("");
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const busy = runner.running;
  // A question from a refine on this page comes first; otherwise the one this run stopped on.
  const question = runner.question ?? (savedQuestion ? { text: savedQuestion, runId } : null);
  const parentRunId = question?.runId ?? runId;

  async function send(message: string) {
    setLastMessage(message);
    const outcome = await runner.run(message, parentRunId);
    if (outcome === "needs_input") setText("");
  }

  function apply(edit: RequestEdit) {
    setEditing(null);
    void send(editMessage(edit));
  }

  function closeEditor() {
    const field = editing;
    setEditing(null);
    if (field) chipRefs.current.get(field)?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const message = text.trim();
    if (!message) return runner.fail(question ? "Type your answer first." : "Type what to change, for example \"cheaper hotel\".");
    if (message.length > MAX_LENGTH) return runner.fail(`Please keep it under ${MAX_LENGTH} characters (it is ${message.length}).`);
    void send(message);
  }

  return (
    <>
      <div className="mt-4 space-y-4">
        <ul aria-label="Your request" className="flex flex-wrap gap-2">
          {toChips(request).map((chip) =>
            chip.kind === "field" ? (
              <li key={chip.field}>
                <Chip
                  ref={(el) => {
                    if (el) chipRefs.current.set(chip.field, el);
                  }}
                  label={chip.label}
                  value={chip.value}
                  trailing={chip.note && <span className="text-xs opacity-75">({chip.note})</span>}
                  aria-expanded={editing === chip.field}
                  aria-controls={editing === chip.field ? EDITOR_ID : undefined}
                  disabled={busy}
                  className={cx(chip.missing && "ring-1 ring-warning")}
                  onClick={() => setEditing(editing === chip.field ? null : chip.field)}
                />
              </li>
            ) : (
              <li key={`pref-${chip.value}`}>
                <Chip
                  label={chip.label}
                  value={chip.value}
                  aria-label={`Remove the preference "${chip.value}"`}
                  trailing={<span aria-hidden="true">×</span>}
                  disabled={busy}
                  onClick={() => apply({ field: "removePreference", value: chip.value })}
                />
              </li>
            ),
          )}
        </ul>
        <p className="sr-only">Choose a detail to change it. Changing one runs the search again.</p>

        {editing && !busy && (
          // Keyed by field so switching chips starts the editor fresh.
          <ChipEditor key={editing} id={EDITOR_ID} field={editing} start={editStart(editing, request)} onApply={apply} onCancel={closeEditor} />
        )}

        {question && !busy && (
          <div className="rounded-lg border border-accent/40 bg-accent-soft px-5 py-4" role="status">
            <p className="text-xs font-medium uppercase tracking-wide text-accent-strong">One more detail</p>
            <p className="mt-1 text-base font-medium text-ink">{question.text}</p>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="refine" className="sr-only">
            {question ? "Your answer" : "Refine this search"}
          </label>
          <Input
            id="refine"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            maxLength={MAX_LENGTH + 200}
            placeholder={question ? "Your answer" : "Refine, e.g. cheaper hotel or nonstop only"}
            className="sm:flex-1"
          />
          <Button type="submit" variant="secondary" disabled={busy}>
            {question ? "Reply" : "Refine"}
          </Button>
        </form>

        {runner.phase.kind === "running" && <RunProgress events={runner.phase.events} startedAt={runner.phase.startedAt} />}
        {runner.phase.kind === "error" && (
          <ErrorState
            title="That didn't work"
            action={
              lastMessage && (
                <Button variant="secondary" onClick={() => void send(lastMessage)}>
                  Try again
                </Button>
              )
            }
          >
            {runner.phase.message}
          </ErrorState>
        )}
      </div>

      <div aria-busy={busy} className={cx("transition-opacity duration-150", busy && "pointer-events-none opacity-50")}>
        {children}
      </div>
    </>
  );
}
