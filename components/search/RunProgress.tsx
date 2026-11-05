"use client";

import { useEffect, useState } from "react";
import type { RunEvent } from "@/lib/runClient";
import { cx } from "@/components/ui/cx";

const STEPS: { label: string; tools: string[] }[] = [
  { label: "Reading your request", tools: ["recordRequest"] },
  { label: "Finding airports", tools: ["lookupAirport"] },
  { label: "Searching flights", tools: ["searchFlights"] },
  { label: "Checking hotels", tools: ["searchHotels"] },
  { label: "Putting packages together", tools: ["presentTrips"] },
];

type Status = "done" | "active" | "waiting";

/** Each step is done once a later step has started; steps the agent skipped count as done too. */
export function stepStatuses(events: RunEvent[]): Status[] {
  const reached = events
    .filter((e) => e.type === "tool_call")
    .map((e) => STEPS.findIndex((s) => s.tools.includes((e as { name: string }).name)))
    .reduce((max, i) => Math.max(max, i), 0);
  return STEPS.map((_, i) => (i < reached ? "done" : i === reached ? "active" : "waiting"));
}

/** Named steps while the agent works, with the time so far (a full search can take a minute). */
export function RunProgress({ events, startedAt }: { events: RunEvent[]; startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const statuses = stepStatuses(events);
  const current = STEPS[statuses.indexOf("active")]?.label ?? STEPS[0].label;
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));

  return (
    <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-semibold text-ink" aria-live="polite">
          {current}…
        </p>
        <p className="text-sm tabular-nums text-muted">{seconds}s</p>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <li key={step.label} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden="true"
              className={cx(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                statuses[i] === "done" && "border-accent bg-accent text-on-accent",
                statuses[i] === "active" && "border-accent motion-safe:animate-pulse",
                statuses[i] === "waiting" && "border-line",
              )}
            >
              {statuses[i] === "done" && (
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className={statuses[i] === "waiting" ? "text-muted" : "text-ink"}>
              {step.label}
              <span className="sr-only">{statuses[i] === "done" ? " (done)" : statuses[i] === "active" ? " (in progress)" : ""}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
