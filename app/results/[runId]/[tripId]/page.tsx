import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getRun, publicRun } from "@/agent/runStore";
import { getAirport } from "@/mcp-server/lib/data";
import { FlightSegments } from "@/components/trip/FlightSegments";
import { ReturnFlights } from "@/components/trip/ReturnFlights";
import { AgentTrace, Assumptions, CostBreakdown, HotelCard } from "@/components/trip/TripSections";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDay, formatDayRange, formatMoney, plural } from "@/lib/format";
import { returnMode } from "@/lib/tripDetail";
import { budgetLabel, placeName } from "@/lib/tripRow";

export const metadata: Metadata = { title: "Trip details" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </Card>
  );
}

/** Reads the run and trip for this URL; both are only known at request time, so this streams in behind Suspense. */
async function Trip({ params }: { params: PageProps<"/results/[runId]/[tripId]">["params"] }) {
  const { runId, tripId } = await params;
  const saved = await getRun(runId);
  const trip = saved?.trips?.find((t) => t.tripId === tripId);
  if (!saved || !trip || saved.status !== "done") notFound();
  const run = publicRun(saved);
  const shown = run.trips!.find((t) => t.tripId === tripId)!;
  const place = placeName(shown, (await getAirport(shown.destination))?.city);
  const budget = budgetLabel(shown.withinBudget, shown.totals.difference);
  const returnDate = shown.flight.returnDate ?? run.request?.returnDate ?? shown.hotel.checkOut;

  return (
    <>
      <p className="text-sm">
        <Link href={`/results/${run.runId}`} className="text-accent hover:underline">
          ← All trips
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{place}</h1>
            {shown.bestMatch && <Badge tone="accent">Best match</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {formatDayRange(shown.flight.departDate, returnDate)} · {plural(shown.travelers, "traveler")} · from{" "}
            {shown.flight.origin}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <p className="text-2xl font-semibold text-ink">{formatMoney(shown.totals.total)}</p>
          <Badge tone={budget.tone}>{budget.text}</Badge>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink">{shown.reason}</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Section title={`Outbound · ${formatDay(shown.flight.departDate)}`}>
            <FlightSegments flight={shown.flight} />
          </Section>
          <Section title="Return">
            <ReturnFlights
              runId={run.runId}
              tripId={shown.tripId}
              returnDate={returnDate}
              includedFare={shown.flight.price}
              mode={returnMode(run, shown)}
              initial={run.returns?.[shown.tripId] ?? null}
            />
          </Section>
          <Section title={`Hotel · ${plural(shown.hotel.nights, "night")}`}>
            <HotelCard hotel={shown.hotel} />
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Cost">
            <CostBreakdown trip={shown} />
          </Section>
          <Section title="Assumptions">
            <Assumptions trip={shown} request={run.request} />
          </Section>
        </div>
      </div>

      <div className="mt-4">
        <AgentTrace trace={run.trace} />
      </div>
    </>
  );
}

function TripSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-4 h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export default function TripPage({ params }: PageProps<"/results/[runId]/[tripId]">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<TripSkeleton />}>
        <Trip params={params} />
      </Suspense>
    </main>
  );
}
