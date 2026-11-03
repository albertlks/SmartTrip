"use client";

import type { Idea } from "@/agent/ideas";
import { cx } from "@/components/ui/cx";
import { seasonLabel } from "@/lib/ideas";
import { useSearch } from "./SearchProvider";

// Decorative bands only: all text sits on the card surface, so contrast comes from the design tokens.
const THEME_BANDS: Record<Idea["theme"], string> = {
  warm: "from-amber-400 to-rose-500",
  winter: "from-sky-400 to-indigo-500",
  food: "from-orange-400 to-red-500",
  adventure: "from-emerald-400 to-teal-600",
  city: "from-violet-500 to-indigo-600",
};

export function IdeaCards({ ideas, monthName }: { ideas: Idea[]; monthName: string }) {
  const { fillFromIdea } = useSearch();
  return (
    <section aria-labelledby="ideas-heading">
      <h2 id="ideas-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
        Ideas for {monthName}
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ideas.map((idea) => (
          <li key={idea.title}>
            <button
              type="button"
              onClick={() => fillFromIdea(idea.prompt)}
              className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left shadow-card transition-[box-shadow,border-color] duration-150 hover:border-muted hover:shadow-raised"
            >
              <span aria-hidden="true" className={cx("h-2 w-full bg-linear-to-r", THEME_BANDS[idea.theme])} />
              <span className="flex flex-1 flex-col gap-1 p-4">
                <span className="font-semibold text-ink">{idea.title}</span>
                <span className="text-sm text-muted">{idea.tagline}</span>
                <span className="mt-2 text-xs font-medium text-muted">
                  {idea.destinationCity} · {seasonLabel(idea.months)}
                </span>
              </span>
              <span className="sr-only">: fills the search box with a sample request</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
