import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";

/** Shown for a trip id that isn't part of the run (or a run that doesn't exist). */
export default function TripNotFound() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <EmptyState
        title="This trip could not be found"
        action={
          <Link href="/" className={buttonClass()}>
            Start a new search
          </Link>
        }
      >
        The link may be mistyped, or the search was saved on another computer.
      </EmptyState>
    </main>
  );
}
