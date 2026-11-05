"use client";

import { useEffect, useState } from "react";
import type { ReturnFlightsResponse } from "@/agent/runReturns";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDay } from "@/lib/format";
import { returnPriceLabel, type ReturnMode } from "@/lib/tripDetail";
import { flightSummary } from "@/lib/tripRow";

const SHOWN = 3;

type State = { kind: "idle" } | { kind: "loading" } | { kind: "done"; result: ReturnFlightsResponse };

async function fetchReturns(runId: string, tripId: string): Promise<ReturnFlightsResponse> {
  try {
    const res = await fetch(`/api/run/${runId}/trips/${tripId}/return`, { method: "POST" });
    return (await res.json()) as ReturnFlightsResponse;
  } catch {
    return { error: "Return flight details unavailable: couldn't reach SmartTrip. Check your connection." };
  }
}

/**
 * The trip's return options, cheapest first. Saved or free results load on open; a live flight waits for a click,
 * so viewing a trip never spends a SerpApi search by itself.
 */
export function ReturnFlights({
  runId,
  tripId,
  returnDate,
  includedFare,
  mode,
  initial,
}: {
  runId: string;
  tripId: string;
  returnDate: string;
  /** The round-trip fare per person already in the total. */
  includedFare: number;
  mode: ReturnMode;
  initial: ReturnFlightsResponse | null;
}) {
  const [state, setState] = useState<State>(initial ? { kind: "done", result: initial } : { kind: mode === "auto" ? "loading" : "idle" });
  const [showAll, setShowAll] = useState(false);

  const load = () => {
    setState({ kind: "loading" });
    void fetchReturns(runId, tripId).then((result) => setState({ kind: "done", result }));
  };

  useEffect(() => {
    if (mode === "auto" && !initial) {
      let live = true;
      void fetchReturns(runId, tripId).then((result) => live && setState({ kind: "done", result }));
      return () => {
        live = false;
      };
    }
  }, [mode, initial, runId, tripId]);

  if (state.kind === "idle") {
    return (
      <div className="text-sm">
        <p className="text-muted">Return on {formatDay(returnDate)}. The fare in your total already covers a return flight.</p>
        <Button variant="secondary" className="mt-3" onClick={load}>
          Show return flights
        </Button>
      </div>
    );
  }
  if (state.kind === "loading") {
    return (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only">Loading return flights…</span>
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }
  const { result } = state;
  if ("error" in result) {
    return (
      <p role="status" className="text-sm text-muted">
        {result.error} The fare in your total already covers a return flight on {formatDay(returnDate)}.
      </p>
    );
  }

  const options = showAll ? result.options : result.options.slice(0, SHOWN);
  return (
    <div>
      <p className="text-sm text-muted">
        {formatDay(returnDate)} · cheapest of {result.options.length} option{result.options.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
        {options.map((option) => {
          const s = flightSummary(option);
          const price = returnPriceLabel(option, includedFare);
          return (
            <li key={option.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-ink">
                  {s.times ?? s.departDay}
                  {s.arriveOffset && <sup className="ml-0.5 text-xs text-muted">{s.arriveOffset}</sup>}
                </p>
                <p className="text-muted">
                  {[s.stops + (s.layovers ? ` · ${s.layovers}` : ""), s.duration, s.airline, s.flightNumbers].filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className={price.included ? "font-medium text-success" : "text-muted"}>{price.text}</p>
            </li>
          );
        })}
      </ul>
      {result.options.length > SHOWN && (
        <Button variant="quiet" className="mt-2" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? "Show fewer" : `Show all ${result.options.length}`}
        </Button>
      )}
    </div>
  );
}
