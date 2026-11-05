"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { parseEdit, type ChipField, type EditInput, type RequestEdit } from "@/lib/requestChips";

const LABELS: Record<ChipField, string> = {
  origin: "Starting city or airport",
  destinations: "Destinations (separate with commas)",
  dates: "Dates",
  travelers: "Number of travelers",
  budget: "Total budget in dollars",
};

/** Edits one chip's value. Enter applies, Escape cancels. */
export function ChipEditor({
  id,
  field,
  start,
  onApply,
  onCancel,
}: {
  id: string;
  field: ChipField;
  start: EditInput;
  onApply: (edit: RequestEdit) => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState<EditInput>(start);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;
  const set = (key: keyof EditInput) => (e: { target: { value: string } }) => setInput((i) => ({ ...i, [key]: e.target.value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseEdit(field, input);
    if ("error" in parsed) setError(parsed.error);
    else onApply(parsed.edit);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  const fieldProps = { "aria-invalid": error ? true : undefined, "aria-describedby": error ? errorId : undefined };

  return (
    <form id={id} onSubmit={onSubmit} onKeyDown={onKeyDown} className="rounded-lg border border-line bg-surface p-4 shadow-card">
      {field === "dates" ? (
        <fieldset>
          <legend className="text-sm font-medium text-ink">{LABELS.dates}</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-muted">
              Depart
              <Input type="date" value={input.departDate} onChange={set("departDate")} autoFocus className="mt-1" {...fieldProps} />
            </label>
            <label className="text-sm text-muted">
              Return
              <Input type="date" value={input.returnDate} onChange={set("returnDate")} className="mt-1" {...fieldProps} />
            </label>
          </div>
        </fieldset>
      ) : (
        <label className="block text-sm font-medium text-ink">
          {LABELS[field]}
          <Input
            value={input.value}
            onChange={set("value")}
            autoFocus
            inputMode={field === "travelers" || field === "budget" ? "numeric" : undefined}
            className="mt-2"
            {...fieldProps}
          />
        </label>
      )}
      {error && (
        <p id={errorId} className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button type="submit">Update search</Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
