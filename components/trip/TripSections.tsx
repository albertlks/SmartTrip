import { Badge } from "@/components/ui/Badge";
import { formatMoney, plural } from "@/lib/format";
import { assumptions, costLines, traceArgs, traceSummary } from "@/lib/tripDetail";
import { budgetLabel, type PublicRun, type PublicTrip } from "@/lib/tripRow";

// The trip page's smaller sections. Each one only displays saved fields, through the helpers in lib/tripDetail.ts.

export function HotelCard({ hotel }: { hotel: PublicTrip["hotel"] }) {
  const facts = [
    hotel.area && `${hotel.area}, ${hotel.city}`,
    hotel.rating && `${hotel.rating.toFixed(1)} rating`,
    hotel.tier && `${hotel.tier[0].toUpperCase()}${hotel.tier.slice(1)}`,
    hotel.milesToAirport !== undefined && `${hotel.milesToAirport} mi from the airport`,
  ].filter(Boolean);
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-base font-semibold text-ink">{hotel.name}</p>
        <p className="text-ink">
          {formatMoney(hotel.pricePerNight)}/night · {plural(hotel.nights, "night")} ·{" "}
          <span className="font-semibold">{formatMoney(hotel.stayTotal)}</span>
        </p>
      </div>
      <p className="mt-1 text-muted">{facts.join(" · ")}</p>
      {hotel.notes && <p className="mt-1 text-muted">{hotel.notes}</p>}
    </div>
  );
}

export function CostBreakdown({ trip }: { trip: PublicTrip }) {
  const budget = budgetLabel(trip.withinBudget, trip.totals.difference);
  return (
    <dl className="text-sm">
      {costLines(trip).map((line) => (
        <div key={line.label} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
          <dt>
            <span className="text-ink">{line.label}</span>
            {line.estimate && <span className="text-muted"> (estimate)</span>}
            <span className="block text-xs text-muted">{line.detail}</span>
          </dt>
          <dd className="tabular-nums text-ink">{formatMoney(line.amount)}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 py-2">
        <dt className="font-semibold text-ink">Total for {plural(trip.travelers, "traveler")}</dt>
        <dd className="text-lg font-semibold tabular-nums text-ink">{formatMoney(trip.totals.total)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted">Your budget</dt>
        <dd className="tabular-nums text-muted">{formatMoney(trip.totals.budget)}</dd>
      </div>
      <div className="mt-2 flex justify-end">
        <Badge tone={budget.tone}>{budget.text}</Badge>
      </div>
    </dl>
  );
}

export function Assumptions({ trip, request }: { trip: PublicTrip; request: PublicRun["request"] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
      {assumptions(trip, request).map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
}

/** Every tool call the agent made for this search, collapsed by default. */
export function AgentTrace({ trace }: { trace: PublicRun["trace"] }) {
  return (
    <details className="group rounded-lg border border-line bg-surface shadow-card">
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="mr-2 inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        How SmartTrip planned this <span className="font-normal text-muted">· {plural(trace.length, "tool call")}</span>
      </summary>
      <ol className="divide-y divide-line border-t border-line">
        {trace.map((entry, i) => (
          <li key={i} className="px-5 py-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xs text-muted">Step {entry.step}</span>
              <code className="font-mono text-ink">{entry.name}</code>
              {entry.isError && <Badge tone="danger">Error</Badge>}
              <span className="ml-auto text-xs tabular-nums text-muted">{entry.ms} ms</span>
            </div>
            <p className="mt-1 text-muted">{traceSummary(entry)}</p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-accent">Arguments</summary>
              <pre className="mt-1 overflow-x-auto rounded-md bg-raised p-3 font-mono text-xs text-ink">{traceArgs(entry)}</pre>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
