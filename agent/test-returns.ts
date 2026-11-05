// Run with: npx tsx agent/test-returns.ts
// No LLM or API calls: runs are driven by a scripted fake LLM on the saved SerpApi fixtures, and saved to a temporary folder.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST } from "../app/api/run/[runId]/trips/[tripId]/return/route";
import { fakeLlm, type FakeTurn } from "./fakeLlm";
import { getReturnFlights } from "./runReturns";
import { clearRunMemory, getRun, publicRun, saveRun, type SavedRun } from "./runStore";
import { prepareRun, runStream } from "./runService";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

const request = {
  origin: "Honolulu",
  destinations: ["Seattle"],
  destinationsFromIdeas: false,
  departDate: "2026-12-11",
  returnDate: "2026-12-15",
  travelers: 1,
  travelersDefaulted: false,
  budget: 2000,
  preferences: [],
  question: null,
};

/** A finished run on the saved Dec 11-15 fixture: trip t1 is its cheapest flight (which has a return fixture), t2 the 2nd. */
async function fixtureRun(): Promise<SavedRun> {
  process.env.FLIGHT_PROVIDER = "fixture";
  const turns: FakeTurn[] = [
    { calls: [{ name: "recordRequest", args: request }] },
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
            budget: 2000,
            travelers: 1,
            trips: [
              { flightId: "f-1444-01", hotelId: "h002", reason: "Cheapest fare." },
              { flightId: "f-1444-02", hotelId: "h008", reason: "Later start." },
            ],
          },
        },
      ],
    },
    { text: "Done." },
  ];
  const text = await new Response(runStream(await prepareRun({ message: "HNL to SEA Dec 11-15, $2,000" }), { llm: fakeLlm(turns) })).text();
  const runId = (JSON.parse(text.split("\n")[0]) as { runId: string }).runId;
  const run = await getRun(runId);
  if (!run?.trips?.length) throw new Error(`The fixture run has no trips: ${text}`);
  return run;
}

const post = (runId: string, tripId: string) =>
  POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ runId, tripId }) });

async function main() {
  process.env.SMARTTRIP_RUNS_DIR = await mkdtemp(path.join(tmpdir(), "smarttrip-returns-"));
  process.env.SMARTTRIP_CACHE_DIR = await mkdtemp(path.join(tmpdir(), "smarttrip-cache-"));
  const run = await fixtureRun();
  const t1 = run.trips!.find((t) => t.flight.id === "f-1444-01")!;

  // ---- fixture: mapped, sorted, and saved on the run ----
  const first = await getReturnFlights(run, t1.tripId);
  const options = first && "options" in first ? first.options : [];
  check("the saved return fixture maps into options", options.length === 8, JSON.stringify(first).slice(0, 200));
  check("options are sorted by price, cheapest first", options.every((o, i) => i === 0 || options[i - 1].price <= o.price));
  check(
    "options fly back from the destination on the return date",
    options.every((o) => o.origin === "SEA" && o.destination === "HNL" && o.departDate === "2026-12-15"),
  );
  check("the cheapest return matches the outbound fare", options[0]?.price === t1.flight.price, `${options[0]?.price} vs ${t1.flight.price}`);
  const outboundIds = new Set(run.trips!.map((t) => t.flight.id));
  check("return ids never collide with outbound ids", options.every((o) => !outboundIds.has(o.id)));

  clearRunMemory(); // as after a restart: the saved result must come from disk
  const reloaded = await getRun(run.runId);
  check("the result is saved on the run", Boolean(reloaded?.returns?.[t1.tripId]));

  // A second request must not fetch again: make a fetch impossible (a live flight with no key) and ask again.
  delete process.env.SERPAPI_API_KEY;
  const live = { ...reloaded!, trips: reloaded!.trips!.map((t) => ({ ...t, flight: { ...t.flight, source: "serpapi" as const } })) };
  await saveRun(live);
  const again = await getReturnFlights(live, t1.tripId);
  check("a second request is answered from the saved run, with no search", Boolean(again && "options" in again && again.options.length === 8));

  // ---- failures are readable, 200, and not saved ----
  const t2 = live.trips!.find((t) => t.flight.id === "f-1444-02")!;
  const noKey = await getReturnFlights(live, t2.tripId);
  check(
    "a live flight without a SerpApi key gives a readable reason",
    Boolean(noKey && "error" in noKey && /^Return flight details unavailable: .*SERPAPI_API_KEY/.test(noKey.error)),
    JSON.stringify(noKey),
  );
  check("a failure is not saved, so a later retry can work", !(await getRun(live.runId))?.returns?.[t2.tripId]);

  const fixtureOnly = { ...live, trips: live.trips!.map((t) => ({ ...t, flight: { ...t.flight, source: "fixture" as const } })), returns: {} };
  const noFixture = await getReturnFlights(fixtureOnly, t2.tripId);
  check(
    "a fixture flight without a saved return fixture says so",
    Boolean(noFixture && "error" in noFixture && /no saved return fixture/.test(noFixture.error)),
    JSON.stringify(noFixture),
  );
  const mock = { ...live, trips: live.trips!.map((t) => ({ ...t, flight: { ...t.flight, source: "mock" as const } })), returns: {} };
  const mockResult = await getReturnFlights(mock, t1.tripId);
  check(
    "sample flights have no return options, and nothing is invented",
    Boolean(mockResult && "error" in mockResult && /only available with live flight search/.test(mockResult.error)),
  );
  check("an unknown trip gives null", (await getReturnFlights(live, "t99")) === null);

  // ---- the route ----
  const ok = await post(live.runId, t1.tripId);
  const okBody = await ok.text();
  check("the route answers 200 with the options", ok.status === 200 && JSON.parse(okBody).options?.length === 8);
  check("no departure token reaches the browser", !/FIXTURE_TOKEN|departureToken|departure_token/.test(okBody));
  const failed = await post(live.runId, t2.tripId);
  check("a failure is still HTTP 200 with { error }", failed.status === 200 && "error" in (await failed.json()));
  check("an unknown trip is 404", (await post(live.runId, "t99")).status === 404);
  check("an unknown run is 404", (await post(crypto.randomUUID(), "t1")).status === 404);
  check("a run id that isn't a UUID is 404", (await post("../secrets", "t1")).status === 404);
  check("the run's public view has no departure tokens", !/FIXTURE_TOKEN|departureToken/.test(JSON.stringify(publicRun(live))));

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll return-flight checks passed");
  process.exit(failures ? 1 : 0);
}

main();
