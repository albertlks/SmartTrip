// Run with: npx tsx agent/test-agent.ts
// No LLM or API calls: the agent loop is driven by a scripted fake LLM, and the tools use mock data.
import { readFileSync } from "node:fs";
import path from "node:path";
import type OpenAI from "openai";
import { IDEA_THEMES, loadIdeas } from "./ideas";
import { recordRequest } from "./recordRequest";
import { fakeLlm, type FakeTurn as Turn } from "./fakeLlm";
import { runAgent } from "./runAgent";
import { localToday, systemPrompt } from "./systemPrompt";

const root = path.resolve(import.meta.dirname, "..");
const readData = (file: string) => JSON.parse(readFileSync(path.join(root, "data", file), "utf8"));

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

const TODAY = "2026-11-01";
const complete = {
  origin: "Honolulu",
  destinations: ["Seattle"],
  destinationsFromIdeas: false,
  departDate: "2026-12-11",
  returnDate: "2026-12-15",
  travelers: 2,
  travelersDefaulted: false,
  budget: 1600,
  preferences: ["nonstop"],
  question: null,
};
const record = (changes: object) => recordRequest(JSON.stringify({ ...complete, ...changes }), TODAY);
const errorOf = (r: ReturnType<typeof recordRequest>) => ("error" in r ? r.error : "");


async function main() {
  // ---- data/ideas.json ----
  const ideas = loadIdeas();
  const airports = new Set(readData("airports.json").map((a: { code: string }) => a.code));
  check(`ideas.json has 10 to 14 ideas (${ideas.length})`, ideas.length >= 10 && ideas.length <= 14);
  const badIdeas = ideas.filter(
    (i) =>
      !i.title || !i.tagline || !i.destinationCity || !i.prompt.includes("{origin}") ||
      !IDEA_THEMES.includes(i.theme) || !i.months.length || i.months.some((m) => !Number.isInteger(m) || m < 1 || m > 12) ||
      Math.abs(i.cityLatitude) > 90 || Math.abs(i.cityLongitude) > 180,
  );
  check("every idea has all fields, a valid theme and months, and {origin} in its prompt", badIdeas.length === 0, badIdeas.map((i) => i.title).join(", "));
  const unknown = ideas.filter((i) => !airports.has(i.airport)).map((i) => i.airport);
  check("every idea airport is in airports.json", unknown.length === 0, unknown.join(", "));
  const thinMonths = [...Array(12).keys()].map((m) => m + 1).filter((m) => ideas.filter((i) => i.months.includes(m)).length < 4);
  check("every month has at least 4 ideas", thinMonths.length === 0, `months: ${thinMonths.join(", ")}`);

  // ---- mock data covers every idea ----
  const flights = readData("flights.json") as { origin: string; destination: string }[];
  const hotels = readData("hotels.json") as { destination: string }[];
  const uncovered = ideas.filter(
    (i) => !flights.some((f) => f.origin === "HNL" && f.destination === i.airport) || !hotels.some((h) => h.destination === i.airport),
  );
  check("mock flights from HNL and mock hotels exist for every idea airport", uncovered.length === 0, uncovered.map((i) => i.airport).join(", "));

  // ---- recordRequest validation ----
  const ok = record({});
  check("a complete request is recorded with nothing missing", "request" in ok && ok.request.missing.length === 0, errorOf(ok));
  check("no budget and no question -> error naming budget", /Missing: budget/.test(errorOf(record({ budget: null }))));
  const asked = record({ budget: null, question: "What's your total budget?" });
  check("no budget with a question -> recorded, missing budget", "request" in asked && asked.request.missing.join() === "budget", errorOf(asked));
  check("no origin -> missing origin", /Missing: origin/.test(errorOf(record({ origin: null }))));
  check("one date missing -> missing dates", /Missing: dates/.test(errorOf(record({ returnDate: null }))));
  const fromIdeas = record({ destinations: ["Cancún", "San Diego"], destinationsFromIdeas: true });
  check("destinations chosen from ideas count as a destination", "request" in fromIdeas && fromIdeas.request.missing.length === 0, errorOf(fromIdeas));
  check("more than 3 destinations -> error", /destinations/.test(errorOf(record({ destinations: ["A", "B", "C", "D"] }))));
  check("a past departDate -> error", /in the past/.test(errorOf(record({ departDate: "2026-10-01" }))));
  check("returnDate before departDate -> error", /must be after/.test(errorOf(record({ returnDate: "2026-12-10" }))));
  check("an impossible date -> error", /real date/.test(errorOf(record({ departDate: "2026-02-30" }))));
  check("invalid JSON -> error", /not valid JSON/.test(errorOf(recordRequest("{", TODAY))));

  // ---- system prompt ----
  const prompt = systemPrompt(TODAY);
  check("system prompt has today's date and weekday", prompt.includes("Sunday, 2026-11-01"));
  check("system prompt lists every idea airport", ideas.every((i) => prompt.includes(`(${i.airport})`)));
  check("system prompt no longer forbids questions", !/never ask/i.test(prompt));
  check("localToday is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(localToday()));

  // ---- runAgent rules, with a scripted LLM ----
  const user: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: "Honolulu to Seattle Dec 11-15, 2 of us" }];
  const futureRequest = { ...complete, departDate: "2027-12-11", returnDate: "2027-12-15" };
  const search = { origin: "HNL", destination: "SEA", departDate: "2027-12-11", returnDate: "2027-12-15" };
  const searchTurn: Turn = {
    calls: [
      { name: "searchFlights", args: search },
      { name: "searchHotels", args: { destination: "SEA", checkIn: search.departDate, checkOut: search.returnDate } },
    ],
  };
  // Mock ids: f003 is the $385 Delta 1-stop and h002 the $135 Pike Place Inn (14 mi from the airport).
  const present = (travelers = 2): Turn => ({
    calls: [{ name: "presentTrips", args: { budget: 1600, travelers, trips: [{ flightId: "f003", hotelId: "h002", reason: "Walkable hotel." }] } }],
  });

  const question = await runAgent(user, undefined, {
    llm: fakeLlm([
      {
        calls: [
          { name: "recordRequest", args: { ...futureRequest, budget: null, question: "What's your total budget?" } },
          { name: "searchFlights", args: { origin: "HNL", destination: "SEA", departDate: "2027-12-11", returnDate: "2027-12-15" } },
        ],
      },
    ]),
  });
  const searched = question.trace.filter((t) => t.name !== "recordRequest" && !t.isError);
  check("a question ends the run as needs_input", question.status === "needs_input" && question.answer === "What's your total budget?");
  check("no search tool runs alongside the question", searched.length === 0, JSON.stringify(question.trace.map((t) => t.name)));
  check("the request is returned with missing budget", question.request?.missing.join() === "budget");
  const last = question.messages[question.messages.length - 1];
  check("the conversation ends on the question, ready for the answer", last.role === "assistant" && last.content === "What's your total budget?");

  const order = await runAgent(user, undefined, {
    llm: fakeLlm([
      { calls: [{ name: "lookupAirport", args: { query: "Seattle" } }] },
      { calls: [{ name: "recordRequest", args: futureRequest }] },
      { calls: [{ name: "lookupAirport", args: { query: "Seattle" } }] },
      searchTurn,
      present(),
      { text: "Plan." },
    ]),
  });
  check(
    "a search before recordRequest is refused, then works after it",
    /call recordRequest first/.test(order.trace[0]?.result ?? "") && order.trace[2]?.name === "lookupAirport" && !order.trace[2].isError,
    JSON.stringify(order.trace.map((t) => [t.name, t.isError])),
  );
  check("a complete run ends as done with the final text", order.status === "done" && order.answer === "Plan.");
  const [trip] = order.trips ?? [];
  // $385 x 2 + $135 x 4 + ($8 + $2.50 x 14) x 2 = 770 + 540 + 86
  check(
    "runAgent returns the server's trips: best match, totals, and sources",
    order.trips?.length === 1 && trip.bestMatch && trip.totals.total === 1396 && trip.withinBudget &&
      trip.flight.id === "f003" && trip.hotel.nights === 4 && trip.sources.flight === "mock",
    JSON.stringify(trip?.totals),
  );

  const nudge = await runAgent(user, undefined, {
    llm: fakeLlm([
      { text: "What's your budget?" },
      { calls: [{ name: "recordRequest", args: futureRequest }] },
      searchTurn,
      present(),
      { text: "Plan." },
    ]),
  });
  const nudgeMessage = nudge.messages.find((m) => m.role === "user" && String(m.content).startsWith("(SmartTrip)"));
  check("prose without recordRequest gets one nudge, then the run continues", Boolean(nudgeMessage) && nudge.status === "done" && nudge.request !== null);

  const unpresented = await runAgent(user, undefined, {
    llm: fakeLlm([
      { calls: [{ name: "recordRequest", args: futureRequest }] },
      searchTurn,
      { text: "Total $1,396." },
      present(),
      { text: "Plan." },
    ]),
  });
  const presentNudge = unpresented.messages.filter((m) => m.role === "user" && String(m.content).includes("call presentTrips"));
  check(
    "an answer without presentTrips gets one nudge, then presentTrips runs",
    presentNudge.length === 1 && unpresented.trips?.length === 1 && unpresented.answer === "Plan.",
  );

  const stubborn = await runAgent(user, undefined, {
    llm: fakeLlm([{ calls: [{ name: "recordRequest", args: futureRequest }] }, { text: "Total $1,396." }]),
  });
  check("the presentTrips nudge is sent only once", stubborn.status === "done" && stubborn.trips === null);

  const mismatch = await runAgent(user, undefined, {
    llm: fakeLlm([{ calls: [{ name: "recordRequest", args: futureRequest }] }, searchTurn, present(3), { text: "Plan." }]),
  });
  check(
    "presentTrips rejects travelers that differ from the recorded request",
    /recorded request says 2/.test(mismatch.trace.find((t) => t.name === "presentTrips")?.result ?? "") && mismatch.trips === null,
  );

  const capped = await runAgent(user, undefined, { llm: fakeLlm([{ calls: [{ name: "recordRequest", args: futureRequest }] }]) });
  check("hitting the step cap ends as stopped_early", capped.status === "stopped_early" && capped.answer === null);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll agent checks passed");
  process.exit(failures ? 1 : 0);
}

main();
