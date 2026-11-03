import { connection } from "next/server";
import { Suspense } from "react";
import { loadIdeas } from "@/agent/ideas";
import { IdeaCards } from "@/components/search/IdeaCards";
import { SearchBox } from "@/components/search/SearchBox";
import { SearchProvider } from "@/components/search/SearchProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { pickIdeas } from "@/lib/ideas";

/** The ideas depend on today's month, so they render at request time, not when the app is built. */
async function IdeasForThisMonth() {
  await connection();
  const now = new Date();
  const monthName = now.toLocaleDateString("en-US", { month: "long" });
  return <IdeaCards ideas={pickIdeas(loadIdeas(), now.getMonth() + 1)} monthName={monthName} />;
}

function IdeasSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-4 w-32" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Plan trips that fit your budget</h1>
      <p className="mt-3 text-lg text-muted">
        Describe your trip in one sentence. SmartTrip searches flights and hotels, checks every total against your
        budget, and shows complete packages, best match first.
      </p>
      <SearchProvider>
        <div className="mt-8">
          <SearchBox />
        </div>
        <div className="mt-12">
          <Suspense fallback={<IdeasSkeleton />}>
            <IdeasForThisMonth />
          </Suspense>
        </div>
      </SearchProvider>
    </main>
  );
}
