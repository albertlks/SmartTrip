// Run with: npx tsx agent/test-runs.ts
// No LLM or API calls: runs are driven by a scripted fake LLM, and saved runs go to a temporary folder.
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeLlm, type FakeTurn } from "./fakeLlm";
import { clearRunMemory, getRun, isRunId, publicRun } from "./runStore";
import { MAX_MESSAGE_LENGTH, prepareRun, RunInputError, runStream, type RunEvent } from "./runService";
import { editMessage } from "../lib/requestChips";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

async function readEvents(stream: ReadableStream<Uint8Array>): Promise<RunEvent[]> {
  const text = await new Response(stream).text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
}

async function rejection(body: unknown): Promise<string> {
  try {
    await prepareRun(body);
    return "";
  } catch (err) {
    return err instanceof RunInputError ? err.message : `unexpected: ${err}`;
  }
}

const request = {
  origin: "Honolulu",
  destinations: ["Seattle"],
  destinationsFromIdeas: false,
  departDate: "2027-12-11",
  returnDate: "2027-12-15",
  travelers: 2,
  travelersDefaulted: false,
  budget: 1600,
  preferences: [],
  question: null,
};
const planTurns: FakeTurn[] = [
  { calls: [{ name: "recordRequest", args: request }] },
  {
    calls: [
      { name: "searchFlights", args: { origin: "HNL", destination: "SEA", departDate: "2027-12-11", returnDate: "2027-12-15" } },
      { name: "searchHotels", args: { destination: "SEA", checkIn: "2027-12-11", checkOut: "2027-12-15" } },
    ],
  },
  // Mock ids: f003 is a $385 1-stop flight, h002 the $135/night Pike Place Inn.
  { calls: [{ name: "presentTrips", args: { budget: 1600, travelers: 2, trips: [{ flightId: "f003", hotelId: "h002", reason: "Walkable hotel." }] } }] },
  { text: "The best match fits your budget." },
];

async function main() {
  process.env.SMARTTRIP_RUNS_DIR = await mkdtemp(path.join(tmpdir(), "smarttrip-runs-"));

  // ---- input checks, before any LLM call ----
  check("an empty message is rejected", /Type a trip request/.test(await rejection({ message: "  " })));
  check(
    `a message over ${MAX_MESSAGE_LENGTH} characters is rejected`,
    /under 1000/.test(await rejection({ message: "x".repeat(2000) })),
  );
  check("an unknown parent run is rejected", /could not be found/.test(await rejection({ message: "cheaper", parentRunId: crypto.randomUUID() })));
  check("a parent id that isn't a UUID is rejected", /could not be found/.test(await rejection({ message: "cheaper", parentRunId: "../secrets" })));
  check("run ids must be UUIDs", isRunId(crypto.randomUUID()) && !isRunId("../x") && !isRunId("abc"));
  check("an invalid id never reads a file", (await getRun("../../package")) === null);

  // ---- a full run ----
  const events = await readEvents(runStream(await prepareRun({ message: "2 of us, Honolulu to Seattle Dec 11-15, $1,600" }), { llm: fakeLlm(planTurns) }));
  const first = events[0];
  const last = events[events.length - 1];
  check("the stream starts with the run id", first?.type === "run" && isRunId(first.runId), JSON.stringify(first));
  check("the stream ends with done for the same run", last?.type === "done" && "runId" in last && last.runId === (first as { runId: string }).runId);
  const toolNames = events.filter((e) => e.type === "tool_call").map((e) => (e as { name: string }).name);
  check("progress events name each tool", toolNames.join() === "recordRequest,searchFlights,searchHotels,presentTrips", toolNames.join());

  const runId = (first as { runId: string }).runId;
  clearRunMemory(); // as after a server restart
  const saved = await getRun(runId);
  check("the run is saved to disk and loads after a restart", saved?.status === "done" && saved.trips?.length === 1, JSON.stringify(saved?.status));
  check("the saved run has the request, trips, trace, and usage", saved?.request?.budget === 1600 && saved.trace.length === 4 && saved.usage.llmCalls === 4);
  const files = await readdir(process.env.SMARTTRIP_RUNS_DIR);
  check("one file per run, named by its id", files.length === 1 && files[0] === `${runId}.json`, files.join(", "));

  const view = publicRun({ ...saved!, trips: saved!.trips!.map((t) => ({ ...t, flight: { ...t.flight, departureToken: "secret" } })) });
  check("the browser's view has no conversation or flight tokens", !("messages" in view) && !JSON.stringify(view).includes("secret"));

  // ---- a follow-up continues the parent's conversation ----
  const followUp = await readEvents(
    runStream(await prepareRun({ message: "cheaper hotel please", parentRunId: runId }), { llm: fakeLlm(planTurns) }),
  );
  const child = await getRun((followUp[0] as { runId: string }).runId);
  const userMessages = child?.messages.filter((m) => m.role === "user").map((m) => m.content);
  check("a follow-up links to its parent", child?.parentRunId === runId && followUp[0].type === "run" && "parentRunId" in followUp[0]);
  check(
    "a follow-up continues the parent's conversation",
    userMessages?.[0] === "2 of us, Honolulu to Seattle Dec 11-15, $1,600" && userMessages?.at(-1) === "cheaper hotel please",
    JSON.stringify(userMessages),
  );

  // ---- a chip edit is a follow-up that records the changed request ----
  const budgetEdit = editMessage({ field: "budget", value: 1200 });
  const editedTurns = JSON.parse(JSON.stringify(planTurns).replaceAll("1600", "1200")) as FakeTurn[];
  const edited = await readEvents(runStream(await prepareRun({ message: budgetEdit, parentRunId: runId }), { llm: fakeLlm(editedTurns) }));
  const editedRun = await getRun((edited[0] as { runId: string }).runId);
  check(
    "a chip edit links to its parent and ends done",
    editedRun?.parentRunId === runId && edited.at(-1)?.type === "done",
    JSON.stringify(edited.at(-1)),
  );
  check("a chip edit saves the changed request", editedRun?.request?.budget === 1200 && editedRun.trips?.[0]?.totals.budget === 1200);
  check(
    "a chip edit sends the edit as the newest message",
    editedRun?.messages.filter((m) => m.role === "user").at(-1)?.content === budgetEdit,
  );

  // ---- a follow-up reuses the earlier searches while the dates are the same ----
  const reuseTurns: FakeTurn[] = [
    planTurns[0],
    { calls: [{ name: "presentTrips", args: { budget: 1600, travelers: 2, trips: [{ flightId: "f001", hotelId: "h002", reason: "Nonstop." }] } }] },
    { text: "Here is the nonstop option." },
  ];
  const reused = await readEvents(runStream(await prepareRun({ message: "nonstop only", parentRunId: runId }), { llm: fakeLlm(reuseTurns) }));
  const reusedRun = await getRun((reused[0] as { runId: string }).runId);
  check(
    "a follow-up can present ids from the earlier searches without searching again",
    reusedRun?.status === "done" && reusedRun.trips?.[0]?.flight.id === "f001" && !reusedRun.trace.some((t) => t.name.startsWith("search")),
    JSON.stringify(reusedRun?.trace.map((t) => `${t.name}${t.isError ? "!" : ""}`)),
  );
  check("the follow-up keeps the conversation's search results", (reusedRun?.results?.length ?? 0) >= (saved?.results?.length ?? 1));
  check("search results never reach the browser", !("results" in publicRun(reusedRun!)));

  const movedTurns: FakeTurn[] = [
    { calls: [{ name: "recordRequest", args: { ...request, departDate: "2027-12-12", returnDate: "2027-12-16" } }] },
    { calls: [{ name: "presentTrips", args: { budget: 1600, travelers: 2, trips: [{ flightId: "f003", hotelId: "h002", reason: "Same as before." }] } }] },
    { text: "Done." },
  ];
  const moved = await readEvents(runStream(await prepareRun({ message: "a day later", parentRunId: runId }), { llm: fakeLlm(movedTurns) }));
  const movedRun = await getRun((moved[0] as { runId: string }).runId);
  const refused = movedRun?.trace.find((t) => t.name === "presentTrips");
  check(
    "after a date change, the old searches are refused with what to do",
    refused?.isError === true && /searched for 2027-12-11 to 2027-12-15.*Search flights again/.test(refused.result),
    refused?.result,
  );

  // ---- a refine can ask a question, and the answer continues that run ----
  const asking: FakeTurn[] = [{ calls: [{ name: "recordRequest", args: { ...request, question: "Which neighborhood do you prefer?" } }] }];
  const refine = await readEvents(runStream(await prepareRun({ message: "a nicer area", parentRunId: runId }), { llm: fakeLlm(asking) }));
  const askedId = (refine[0] as { runId: string }).runId;
  check("a refine can stop with a question", refine.at(-1)?.type === "needs_input", JSON.stringify(refine.at(-1)));
  const answered = await readEvents(runStream(await prepareRun({ message: "Pike Place", parentRunId: askedId }), { llm: fakeLlm(planTurns) }));
  const answeredRun = await getRun((answered[0] as { runId: string }).runId);
  const tail = answeredRun?.messages.slice(-12).map((m) => (typeof m.content === "string" ? m.content : ""));
  check(
    "the answer continues the run that asked, after its question",
    answeredRun?.parentRunId === askedId &&
      answered.at(-1)?.type === "done" &&
      (tail ?? []).includes("Which neighborhood do you prefer?") &&
      (tail ?? []).indexOf("Which neighborhood do you prefer?") < (tail ?? []).indexOf("Pike Place"),
    JSON.stringify(tail),
  );

  // ---- a failing LLM ends with a readable error, and the run is still saved ----
  const broken = { chat: { completions: { create: async () => { throw new TypeError("boom at line 12"); } } } };
  const originalError = console.error;
  console.error = () => {}; // the stack trace goes to the server log; keep the test output clean
  const failed = await readEvents(runStream(await prepareRun({ message: "Honolulu to Seattle" }), { llm: broken as never }));
  console.error = originalError;
  const failure = failed[failed.length - 1];
  check(
    "an unexpected error streams a readable message, not the stack trace",
    failure.type === "error" && /Something went wrong/.test(failure.message) && !failure.message.includes("boom"),
    JSON.stringify(failure),
  );
  const failedRun = await getRun((failed[0] as { runId: string }).runId);
  check("a failed run is saved with status error", failedRun?.status === "error" && Boolean(failedRun.error));

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll run checks passed");
  process.exit(failures ? 1 : 0);
}

main();
