import { getReturnFlights } from "@/agent/runReturns";
import { getRun } from "@/agent/runStore";

/**
 * The return-flight options for one trip. A POST, so link prefetching or crawlers can never spend a SerpApi search.
 * Failures answer 200 with { error } so the detail page can show the reason; unknown runs and trips are 404.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/run/[runId]/trips/[tripId]/return">) {
  const { runId, tripId } = await ctx.params;
  const run = await getRun(runId);
  const result = run && (await getReturnFlights(run, tripId));
  if (!result) return Response.json({ error: "This trip could not be found. Start a new search." }, { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
