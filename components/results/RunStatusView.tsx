import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/States";
import type { PublicRun } from "@/lib/tripRow";

const newSearch = (
  <Link href="/" className={buttonClass({ variant: "secondary" })}>
    Start a new search
  </Link>
);

/** What the results page shows for a run without trips: a question, an empty result, or an error. */
export function RunStatusView({ run }: { run: PublicRun }) {
  if (run.status === "needs_input") {
    return (
      <div className="rounded-lg border border-accent/40 bg-accent-soft px-5 py-4" role="status">
        <p className="text-xs font-medium uppercase tracking-wide text-accent-strong">One more detail needed</p>
        <p className="mt-1 text-base font-medium text-ink">{run.answer}</p>
        <p className="mt-2 text-sm text-ink">This search stopped to ask a question. Start again with that detail included.</p>
        <div className="mt-4">{newSearch}</div>
      </div>
    );
  }
  if (run.status === "stopped_early") {
    return (
      <ErrorState title="The search stopped before it finished" action={newSearch}>
        It ran out of steps before choosing trips. Try a simpler request, for example one destination.
      </ErrorState>
    );
  }
  if (run.status === "error") {
    return (
      <ErrorState title="That search didn't work" action={newSearch}>
        {run.error ?? "Something went wrong while planning your trip. Please try again."}
      </ErrorState>
    );
  }
  return (
    <EmptyState title="No trips to show" action={newSearch}>
      {run.answer || "The search finished without finding a trip that fits. Try other dates, a nearby destination, or a higher budget."}
    </EmptyState>
  );
}
