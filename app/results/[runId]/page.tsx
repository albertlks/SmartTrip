import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getRun, publicRun } from "@/agent/runStore";
import { RunStatusView } from "@/components/results/RunStatusView";
import { TripRow, TripRowSkeleton } from "@/components/results/TripRow";
import { buttonClass } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { plural } from "@/lib/format";
import { requestSummary, toRowView } from "@/lib/tripRow";

export const metadata: Metadata = { title: "Your trips" };

/** Reads the run for this URL. The run id is only known at request time, so this streams in behind Suspense. */
async function Results({ params }: { params: PageProps<"/results/[runId]">["params"] }) {
  const { runId } = await params;
  const saved = await getRun(runId);
  if (!saved) notFound();
  const run = publicRun(saved);
  const trips = run.status === "done" ? (run.trips ?? []) : [];
  const summary = requestSummary(run.request, trips);

  return (
    <>
      {summary.length > 0 && <p className="mt-2 text-sm text-muted">{summary.join(" · ")}</p>}
      {trips.length > 0 ? (
        <>
          <p className="mt-6 text-sm text-muted">
            {plural(trips.length, "package")}, best match first. Totals include round-trip flights for every traveler, the
            hotel, and rides between the airport and the hotel.
          </p>
          <ol className="mt-3 space-y-4">
            {trips.map((trip) => (
              <li key={trip.tripId}>
                <TripRow row={toRowView(trip, run.request)} href={`/results/${run.runId}/${trip.tripId}`} />
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="mt-6">
          <RunStatusView run={run} />
        </div>
      )}
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <Skeleton className="mt-7 h-4 w-96 max-w-full" />
      <div className="mt-3 space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <TripRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function ResultsPage({ params }: PageProps<"/results/[runId]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Your trips</h1>
        <Link href="/" className={buttonClass({ variant: "secondary" })}>
          New search
        </Link>
      </div>
      <Suspense fallback={<ResultsSkeleton />}>
        <Results params={params} />
      </Suspense>
    </main>
  );
}
