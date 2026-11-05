import { prepareRun, RunInputError, runStream } from "@/agent/runService";

/** Starts a run: body { message, parentRunId? }. Streams newline-delimited JSON progress, then the run's status. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON like { \"message\": \"...\" }." }, { status: 400 });
  }
  try {
    const prepared = await prepareRun(body);
    return new Response(runStream(prepared), {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof RunInputError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
