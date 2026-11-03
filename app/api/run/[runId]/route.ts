import { getRun, publicRun } from "@/agent/runStore";

/** A saved run for the results and detail pages, without the internal conversation or flight tokens. */
export async function GET(_request: Request, ctx: RouteContext<"/api/run/[runId]">) {
  const { runId } = await ctx.params;
  const run = await getRun(runId);
  if (!run) return Response.json({ error: "This search could not be found. Start a new search." }, { status: 404 });
  return Response.json(publicRun(run), { headers: { "Cache-Control": "no-store" } });
}
