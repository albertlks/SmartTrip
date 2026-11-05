import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getRun, publicRun } from "@/agent/runStore";
import { getAirport } from "@/mcp-server/lib/data";
import { RefineControls } from "@/components/results/RefineControls";
import { RunStatusView } from "@/components/results/RunStatusView";
import { TripRow, TripRowSkeleton } from "@/components/results/TripRow";
import { buttonClass } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { plural } from "@/lib/format";
import { toRowView } from "@/lib/tripRow";

export const metadata: Metadata = { title: "Your trips" };

/** Reads the run for this URL. The run id is only known at request time, so this streams in behind Suspense. */
async function Results({ params }: { params: PageProps<"/results/[runId]">["params"] }) {
  const { runId } = await params;
  // Badges say how old the data is, so this renders per request.
  await connection();
  const now = new Date().getTime();
  const saved = await getRun(runId);
  if (!saved) notFound();
  const run = publicRun(saved);
  const trips = run.status === "done" ? (run.trips ?? []) : [];
  // Row headings name the destination city, not the hotel's suburb.
  const cities = new Map(
    await Promise.all(trips.map(async (t) => [t.destination, (await getAirport(t.destination))?.city] as const)),
  );

  const body =
    trips.length > 0 ? (
      <>
        <p className="mt-6 text-sm text-muted">
          {plural(trips.length, "package")}, best match first. Totals include round-trip flights for every traveler, the
          hotel, and rides between the airport and the hotel.
        </p>
        <ol className="mt-3 space-y-4">
          {trips.map((trip) => (
            <li key={trip.tripId}>
              <TripRow row={toRowView(trip, run.request, cities.get(trip.destination), now)} href={`/results/${run.runId}/${trip.tripId}`} />
            </li>
          ))}
        </ol>
      </>
    ) : run.status === "needs_input" ? null : (
      // A question is shown with the refine controls, where it can be answered.
      <div className="mt-6">
        <RunStatusView run={run} />
      </div>
    );

  return (
    <>
      {run.parentRunId && (
        <p className="mt-1 text-sm">
          <Link href={`/results/${run.parentRunId}`} className="text-accent hover:underline">
            ← Previous results
          </Link>
        </p>
      )}
      {run.request ? (
        // Keyed by run so a refine that lands here starts with fresh controls.
        <RefineControls key={run.runId} runId={run.runId} request={run.request} question={run.status === "needs_input" ? run.answer : null}>
          {body}
        </RefineControls>
      ) : (
        body
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
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
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
