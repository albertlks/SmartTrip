import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { SourceBadge } from "@/components/SourceBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { RowView } from "@/lib/tripRow";

function Airport({ code, name }: { code: string; name?: string }) {
  return (
    <span>
      <span className="font-medium text-ink">{code}</span>
      {name && <span className="text-muted"> {name}</span>}
    </span>
  );
}

/** One trip package on the results page. The whole row links to the trip's detail page. */
export function TripRow({ row, href }: { row: RowView; href: string }) {
  const flightLine = [row.airline, row.flightNumbers].filter(Boolean).join(" · ");
  return (
    <Link
      href={href}
      className="block rounded-lg border border-line bg-surface p-5 shadow-card transition-[box-shadow,border-color] duration-150 hover:border-muted hover:shadow-raised"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-ink">{row.place}</h2>
        {row.bestMatch && <Badge tone="accent">Best match</Badge>}
        {row.redEye && <Badge tone="warning">Red-eye</Badge>}
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1 text-sm">
          <p className="text-muted">{row.departDay}</p>
          {row.times && (
            <p className="text-lg font-semibold text-ink">
              {row.times}
              {row.arriveOffset && (
                <>
                  <sup aria-hidden="true" className="ml-0.5 text-xs font-medium text-muted">
                    {row.arriveOffset}
                  </sup>
                  <span className="sr-only">, arrives {row.arriveOffset === "+1" ? "the next day" : `${row.arriveOffset.slice(1)} days later`}</span>
                </>
              )}
            </p>
          )}
          <p>
            <Airport {...row.from} /> <span aria-hidden="true">→</span>
            <span className="sr-only">to</span> <Airport {...row.to} />
          </p>
          <p className="text-ink">
            {row.stops}
            {row.layovers && <span className="text-muted"> · {row.layovers}</span>}
            {row.duration && <span className="text-muted"> · {row.duration} total</span>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            {flightLine}
            <SourceBadge freshness={row.sources.flight} />
          </p>
          <p className="text-muted">
            Round trip{row.returnDay && ` · ${row.returnDay}, details on the trip page`}
          </p>
        </div>

        <div className="flex flex-row items-baseline justify-between gap-3 sm:flex-col sm:items-end sm:justify-start sm:gap-1 sm:text-right">
          <div>
            <p className="text-2xl font-semibold text-ink">{row.total}</p>
            <p className="text-xs text-muted">{row.travelers}</p>
          </div>
          <Badge tone={row.budget.tone}>{row.budget.text}</Badge>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-3 text-sm">
        <p>
          <span className="text-muted">Hotel: </span>
          <span className="font-medium text-ink">{row.hotel.name}</span>
          {row.hotel.area && <span className="text-muted">, {row.hotel.area}</span>}
          <span className="text-muted">
            {" "}
            · <span className="whitespace-nowrap">{row.hotel.nightly}</span> · {row.hotel.nights}
          </span>
          {row.weather && <span className="whitespace-nowrap text-muted"> · {row.weather}</span>}{" "}
          <SourceBadge freshness={row.sources.hotel} />
        </p>
        <p className="mt-1 text-muted">{row.reason}</p>
      </div>
    </Link>
  );
}

/** A placeholder with a row's size, so the page doesn't jump when the rows arrive. */
export function TripRowSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-lg border border-line bg-surface p-5 shadow-card">
      <Skeleton className="h-5 w-32" />
      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-12 w-24" />
      </div>
      <Skeleton className="mt-4 h-10" />
    </div>
  );
}
