import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";

/** Shown for a run id that doesn't exist (or was saved on another machine). */
export default function RunNotFound() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <EmptyState
        title="This search could not be found"
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
