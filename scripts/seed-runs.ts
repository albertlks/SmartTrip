// Run with: npm run seed:runs
// Saves example runs to data/runs/ (gitignored) so the results pages can be built and checked without the LLM
// gateway or SerpApi. Each run goes through the real agent loop and tools, driven by a scripted fake LLM, so its
// trips and trace look like a live run's. Ids are fixed, so the URLs stay the same each time you seed.
import { unlink } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { fakeLlm, type FakeTurn } from "../agent/fakeLlm";
import { getRun, saveRun } from "../agent/runStore";
import { prepareRun, runStream, type RunEvent } from "../agent/runService";
import { findFlights } from "../mcp-server/lib/flightProviders";
import { projectRoot } from "../mcp-server/lib/projectRoot";
import { newRunContext } from "../mcp-server/lib/runContext";

type Seed = {
  id: string;
  title: string;
  message: string;
  turns: FakeTurn[] | "unreachable";
  /** Data source for searchFlights in this run. */
  flights?: "mock" | "fixture";
  /** "Today" for the run, so the saved fixture's dates still count as future. */
  today?: string;
};

const seedId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const request = (r: Record<string, unknown>) => ({
  destinationsFromIdeas: false,
  travelersDefaulted: false,
  preferences: [],
  question: null,
  ...r,
});

/** The ids the fixture search gives, so the scripted LLM can pick a nonstop, a 1-stop, and a 2-stop flight. */
async function fixtureFlightIds(): Promise<{ nonstop: string; oneStop: string; twoStop: string }> {
  process.env.FLIGHT_PROVIDER = "fixture";
  const { results } = await findFlights("HNL", "SEA", "2026-10-21", "2026-10-27", newRunContext());
  const pick = (stops: number) => {
    const found = results.find((r) => r.stops === stops && (stops === 0 || r.layovers.length > 0));
    if (!found) throw new Error(`The saved fixture has no ${stops}-stop flight with layover details.`);
    return found.id;
  };
  return { nonstop: pick(0), oneStop: pick(1), twoStop: pick(2) };
}

async function seeds(): Promise<Seed[]> {
  const fixture = await fixtureFlightIds();
  return [
    {
      id: seedId(1),
      title: "Somewhere warm: three destinations, all within budget",
      message: "2 of us from Honolulu, somewhere warm in mid-January, 5 nights, about $2,500 total.",
      turns: [
        {
          calls: [
            {
              name: "recordRequest",
              args: request({
                origin: "Honolulu",
                destinations: ["San Diego", "Phoenix", "Las Vegas"],
                destinationsFromIdeas: true,
                departDate: "2027-01-15",
                returnDate: "2027-01-20",
                travelers: 2,
                budget: 2500,
                preferences: ["warm weather"],
              }),
            },
          ],
        },
        {
          calls: ["SAN", "PHX", "LAS"].flatMap((destination) => [
            { name: "searchFlights", args: { origin: "HNL", destination, departDate: "2027-01-15", returnDate: "2027-01-20" } },
            { name: "searchHotels", args: { destination, checkIn: "2027-01-15", checkOut: "2027-01-20" } },
          ]),
        },
        {
          calls: [
            {
              name: "presentTrips",
              args: {
                budget: 2500,
                travelers: 2,
                trips: [
                  { flightId: "f017", hotelId: "h025", reason: "Nonstop on Hawaiian and a courtyard inn in walkable Old Town." },
                  { flightId: "f019", hotelId: "h028", reason: "Warmest of the three, nonstop, hotel in downtown Phoenix." },
                  { flightId: "f022", hotelId: "h031", reason: "Cheapest package: an overnight nonstop and a downtown hotel." },
                ],
              },
            },
          ],
        },
        { text: "Three warm options, all within your budget. San Diego is the best balance of price and location." },
      ],
    },
    {
      id: seedId(2),
      title: "Tight budget: one trip over budget",
      message: "2 of us, Honolulu to Seattle Dec 11-15, $1,900. Nice hotel downtown if possible.",
      turns: [
        {
          calls: [
            {
              name: "recordRequest",
              args: request({
                origin: "Honolulu",
                destinations: ["Seattle"],
                departDate: "2026-12-11",
                returnDate: "2026-12-15",
                travelers: 2,
                budget: 1900,
                preferences: ["downtown hotel"],
              }),
            },
          ],
        },
        {
          calls: [
            { name: "searchFlights", args: { origin: "HNL", destination: "SEA", departDate: "2026-12-11", returnDate: "2026-12-15" } },
            { name: "searchHotels", args: { destination: "SEA", checkIn: "2026-12-11", checkOut: "2026-12-15" } },
          ],
        },
        {
          calls: [
            {
              name: "presentTrips",
              args: {
                budget: 1900,
                travelers: 2,
                trips: [
                  { flightId: "f001", hotelId: "h001", reason: "The waterfront hotel you asked for, but it goes over budget." },
                  { flightId: "f007", hotelId: "h003", reason: "Cheapest fare and a hostel room; long layovers." },
                  { flightId: "f005", hotelId: "h002", reason: "Nonstop evening flight and a walkable inn by Pike Place." },
                ],
              },
            },
          ],
        },
        { text: "Two packages fit your budget; the downtown waterfront hotel goes over." },
      ],
    },
    {
      id: seedId(3),
      title: "Saved SerpApi fixture: nonstop, 1 stop, and 2 stops with layovers",
      message: "Just me, Honolulu to Seattle Oct 21-27, $2,000.",
      flights: "fixture",
      today: "2026-10-01",
      turns: [
        {
          calls: [
            {
              name: "recordRequest",
              args: request({
                origin: "Honolulu",
                destinations: ["Seattle"],
                departDate: "2026-10-21",
                returnDate: "2026-10-27",
                travelers: 1,
                budget: 2000,
              }),
            },
          ],
        },
        {
          calls: [
            { name: "searchFlights", args: { origin: "HNL", destination: "SEA", departDate: "2026-10-21", returnDate: "2026-10-27" } },
            { name: "searchHotels", args: { destination: "SEA", checkIn: "2026-10-21", checkOut: "2026-10-27" } },
          ],
        },
        {
          calls: [
            {
              name: "presentTrips",
              args: {
                budget: 2000,
                travelers: 1,
                trips: [
                  { flightId: fixture.nonstop, hotelId: "h002", reason: "Cheapest nonstop and a walkable inn by Pike Place." },
                  { flightId: fixture.oneStop, hotelId: "h008", reason: "One short stop at LAX for less, and a boutique hotel in Fremont." },
                  { flightId: fixture.twoStop, hotelId: "h007", reason: "Two stops via LAX and SFO, with a hotel right downtown." },
                ],
              },
            },
          ],
        },
        { text: "Two packages fit your budget; the 2-stop option goes over." },
      ],
    },
    {
      id: seedId(4),
      title: "Needs input: no budget given",
      message: "Honolulu to Portland Dec 11-14 for one person.",
      turns: [
        {
          calls: [
            {
              name: "recordRequest",
              args: request({
                origin: "Honolulu",
                destinations: ["Portland"],
                departDate: "2026-12-11",
                returnDate: "2026-12-14",
                travelers: 1,
                budget: null,
                question: "What's your total budget for the trip?",
              }),
            },
          ],
        },
      ],
    },
    {
      id: seedId(5),
      title: "Done without trips",
      message: "Honolulu to Eugene Dec 11-14, 2 of us, $300 total.",
      turns: [
        {
          calls: [
            {
              name: "recordRequest",
              args: request({
                origin: "Honolulu",
                destinations: ["Eugene"],
                departDate: "2026-12-11",
                returnDate: "2026-12-14",
                travelers: 2,
                budget: 300,
              }),
            },
          ],
        },
        {
          calls: [
            { name: "searchFlights", args: { origin: "HNL", destination: "EUG", departDate: "2026-12-11", returnDate: "2026-12-14" } },
          ],
        },
        {
          text:
            "I couldn't put together a trip for $300: the cheapest round-trip fare to Eugene is more than that for two people " +
            "before any hotel. Try a higher budget or fewer nights.",
        },
      ],
    },
    {
      id: seedId(6),
      title: "Error: the LLM gateway is unreachable",
      message: "Honolulu to Los Angeles Dec 11-15, one traveler, $1,500.",
      turns: "unreachable",
    },
  ];
}

/** A stand-in LLM that fails the way an unreachable gateway does. */
const unreachableLlm = {
  chat: {
    completions: {
      create: async () => {
        throw new OpenAI.APIConnectionError({ message: "Connection error." });
      },
    },
  },
} as unknown as Pick<OpenAI, "chat">;

async function seed(s: Seed): Promise<string> {
  process.env.FLIGHT_PROVIDER = s.flights ?? "mock";
  const llm = s.turns === "unreachable" ? unreachableLlm : fakeLlm(s.turns);
  const text = await new Response(runStream(await prepareRun({ message: s.message }), { llm, today: s.today })).text();
  const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
  const first = events[0];
  const last = events.at(-1);
  if (first?.type !== "run") throw new Error(`${s.title}: the stream did not start with a run id.`);

  // Save under the fixed id and drop the copy under the random one.
  const run = await getRun(first.runId);
  if (!run) throw new Error(`${s.title}: the run was not saved.`);
  const dir = process.env.SMARTTRIP_RUNS_DIR ?? path.join(projectRoot(), "data/runs");
  await saveRun({ ...run, runId: s.id });
  await unlink(path.join(dir, `${first.runId}.json`));
  return `${last?.type ?? "?"}${run.trips ? `, ${run.trips.length} trips` : ""}`;
}

async function main() {
  const original = process.env.FLIGHT_PROVIDER;
  for (const s of await seeds()) {
    const outcome = await seed(s);
    console.log(`${s.title} (${outcome})\n  http://localhost:3000/results/${s.id}`);
  }
  process.env.FLIGHT_PROVIDER = original;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
