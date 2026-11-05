// Run with: npx tsx lib/test-landing.ts
// No network: the run stream is served by a fake fetch.
import { loadIdeas } from "@/agent/ideas";
import { stepStatuses } from "@/components/search/RunProgress";
import { fillPrompt, ORIGIN_BLANK, pickIdeas, seasonLabel } from "./ideas";
import { RunClientError, startRun, type RunEvent } from "./runClient";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

/** A fetch that answers with these chunks of a streamed body (or a status and JSON body). */
function fakeFetch(chunks: string[], status = 200): typeof fetch {
  return (async () => {
    if (status !== 200) return Response.json({ error: "Your request is 2000 characters; please keep it under 1000." }, { status });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
        controller.close();
      },
    });
    return new Response(body);
  }) as typeof fetch;
}

async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (err) {
    return err instanceof RunClientError ? err.message : `unexpected: ${err}`;
  }
}

async function main() {
  // ---- idea cards by month ----
  const ideas = loadIdeas();
  const counts = Array.from({ length: 12 }, (_, i) => pickIdeas(ideas, i + 1).length);
  check("every month shows 4 to 6 cards", counts.every((n) => n >= 4 && n <= 6), counts.join(","));
  const november = pickIdeas(ideas, 11);
  check("November cards are all in season in November", november.every((i) => i.months.includes(11)), november.map((i) => i.airport).join(","));
  const sparse = pickIdeas(
    ideas.map((i) => ({ ...i, months: i.airport === "LAX" ? [5] : i.airport === "SEA" ? [6] : [9] })),
    5,
  );
  check("a month with too few ideas is topped up from next month", sparse.map((i) => i.airport).join() === "LAX,SEA", sparse.map((i) => i.airport).join());

  // ---- filling the box from a card ----
  const blank = fillPrompt("2 of us from {origin} to Cancún, $3,000.", null);
  check(
    `no home airport: "${ORIGIN_BLANK}" is filled in and selected`,
    blank.text === "2 of us from your city to Cancún, $3,000." && blank.select?.[0] === 13 && blank.select?.[1] === 22,
    JSON.stringify(blank),
  );
  const home = fillPrompt("2 of us from {origin} to Cancún.", "Honolulu");
  check("a saved home airport is filled in, nothing selected", home.text === "2 of us from Honolulu to Cancún." && !home.select);

  check("season labels", [
    seasonLabel([12, 1, 2, 3, 4]) === "Dec–Apr",
    seasonLabel([3, 4, 10, 11]) === "Mar–Apr, Oct–Nov",
    seasonLabel([6, 7, 8]) === "Jun–Aug",
    seasonLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) === "Year-round",
  ].every(Boolean));

  // ---- reading the run stream ----
  const events: RunEvent[] = [];
  const lines = [
    { type: "run", runId: "r1" },
    { type: "tool_call", step: 1, name: "recordRequest" },
    { type: "tool_result", step: 1, name: "recordRequest", isError: false, ms: 3 },
    { type: "done", runId: "r1" },
  ].map((e) => JSON.stringify(e) + "\n");
  // Split mid-line, as network chunks can be.
  const joined = lines.join("");
  const final = await startRun("hi", null, (e) => events.push(e), fakeFetch([joined.slice(0, 20), joined.slice(20, 90), joined.slice(90)]));
  check("lines split across chunks are read whole", events.length === 4 && events[1].type === "tool_call", JSON.stringify(events));
  check("startRun resolves with the final event", final.type === "done");

  const question = await startRun("hi", null, () => {}, fakeFetch([JSON.stringify({ type: "needs_input", runId: "r2", question: "What's your budget?" }) + "\n"]));
  check("needs_input carries the question", question.type === "needs_input" && question.question === "What's your budget?");

  check("an HTTP 400 shows the server's message", /under 1000/.test(await errorOf(startRun("x", null, () => {}, fakeFetch([], 400)))));
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  check("a network failure gives a readable message", /Couldn't reach SmartTrip/.test(await errorOf(startRun("x", null, () => {}, offline))));
  check(
    "a stream that ends without a result is an error",
    /ended without a result/.test(await errorOf(startRun("x", null, () => {}, fakeFetch([JSON.stringify({ type: "run", runId: "r3" }) + "\n"])))),
  );

  // ---- progress steps ----
  const call = (name: string): RunEvent => ({ type: "tool_call", step: 1, name });
  check("before any tool: first step active", stepStatuses([]).join() === "active,waiting,waiting,waiting,waiting");
  check(
    "a skipped step (no airport lookup) counts as done once a later step starts",
    stepStatuses([call("recordRequest"), call("searchFlights")]).join() === "done,done,active,waiting,waiting",
  );
  check("presentTrips is the last step", stepStatuses([call("presentTrips")]).join() === "done,done,done,done,active");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll landing checks passed");
  process.exit(failures ? 1 : 0);
}

main();
