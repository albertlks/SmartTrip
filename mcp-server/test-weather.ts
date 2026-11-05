// Run with: npx tsx mcp-server/test-weather.ts
// No network: Open-Meteo is answered from saved fixtures or from a fake fetch that records what was asked.
import { fakeLlm, type FakeTurn } from "../agent/fakeLlm";
import { runAgent } from "../agent/runAgent";
import { conditionsFor, getWeather, LAST_YEAR, tripWeather, weatherSummary } from "./lib/weather";
import { fixtureWeatherFetch } from "./lib/weatherFixtures";

process.env.SMARTTRIP_WEATHER = "fixture";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}

async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** A fake Open-Meteo that answers any date range with made-up but well-formed days, and records each URL. */
function recordingFetch() {
  const urls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    const start = url.searchParams.get("start_date")!;
    const end = url.searchParams.get("end_date")!;
    const time: string[] = [];
    for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      time.push(d.toISOString().slice(0, 10));
    }
    const archive = url.hostname.startsWith("archive");
    return Response.json({
      daily: {
        time,
        temperature_2m_max: time.map(() => 70),
        temperature_2m_min: time.map(() => 60),
        weather_code: time.map(() => 61),
        ...(archive ? { precipitation_sum: time.map(() => 0.1) } : { precipitation_probability_max: time.map(() => 80) }),
      },
    });
  }) as typeof fetch;
  return { urls, impl };
}

async function main() {
  // ---- WMO codes ----
  check("WMO codes become short words", conditionsFor(0) === "Clear" && conditionsFor(3) === "Overcast" && conditionsFor(63) === "Rain");
  check("unknown codes say so", conditionsFor(42) === "Unknown" && conditionsFor(undefined) === "Unknown");

  // ---- the saved fixtures ----
  const today = "2026-11-04";
  const forecast = await getWeather("SEA", "2026-11-05", "2026-11-09", { today, fetchImpl: fixtureWeatherFetch });
  check("a range within 16 days is a forecast", forecast.basis === "forecast" && forecast.days.length === 5);
  check(
    "forecast days have a rain chance and no rainfall",
    forecast.days.every((d) => d.basis === "forecast" && typeof d.rainChance === "number" && d.rainInches === undefined),
  );
  const past = await getWeather("SEA", "2026-12-11", "2026-12-15", { today, fetchImpl: fixtureWeatherFetch });
  check(`a range beyond 16 days is ${LAST_YEAR}`, past.basis === LAST_YEAR && past.days.length === 5);
  check("last-year days keep the trip's dates", past.days.map((d) => d.date).join() === "2026-12-11,2026-12-12,2026-12-13,2026-12-14,2026-12-15");
  check(
    "last-year days have rainfall and no rain chance",
    past.days.every((d) => d.basis === "last year" && typeof d.rainInches === "number" && d.rainChance === undefined),
  );
  check("the summary says it's last year's weather", /last year/.test(past.summary) && /^Highs \d+–\d+°F, lows \d+–\d+°F/.test(past.summary), past.summary);

  // ---- the forecast/last-year split ----
  const rec = recordingFetch();
  // today + 15 = Nov 19: Nov 17-19 are forecast, Nov 20-22 are last year's.
  const mixed = await getWeather("SEA", "2026-11-17", "2026-11-22", { today, fetchImpl: rec.impl });
  check("a range across the 16-day line is mixed", mixed.basis === "mixed");
  check(
    "each day is labelled by where it came from",
    mixed.days.map((d) => d.basis[0]).join("") === "ffflll",
    mixed.days.map((d) => `${d.date}:${d.basis}`).join(", "),
  );
  const [f, a] = [rec.urls.find((u) => !u.hostname.startsWith("archive")), rec.urls.find((u) => u.hostname.startsWith("archive"))];
  check("the forecast asks for Nov 17-19", f?.searchParams.get("start_date") === "2026-11-17" && f.searchParams.get("end_date") === "2026-11-19");
  check(
    "the archive asks for the same dates a year earlier",
    a?.searchParams.get("start_date") === "2025-11-20" && a.searchParams.get("end_date") === "2025-11-22",
  );
  check("temperatures are in Fahrenheit, in local time", f?.searchParams.get("temperature_unit") === "fahrenheit" && f.searchParams.get("timezone") === "auto");
  check("the mixed summary words both kinds", /rain likely on 3 of 3 days/.test(mixed.summary) && /rain on 3 of 3 days last year/.test(mixed.summary), mixed.summary);

  const leap = recordingFetch();
  await getWeather("SEA", "2028-02-28", "2028-03-01", { today: "2027-01-01", fetchImpl: leap.impl });
  check(
    "Feb 29 looks up Feb 28 a year earlier",
    leap.urls[0]?.searchParams.get("start_date") === "2027-02-28" && leap.urls[0]?.searchParams.get("end_date") === "2027-03-01",
  );

  const cached = recordingFetch();
  await getWeather("SEA", "2030-06-01", "2030-06-03", { today: "2030-01-01", fetchImpl: cached.impl });
  await getWeather("SEA", "2030-06-01", "2030-06-03", { today: "2030-01-01", fetchImpl: cached.impl });
  check("the same lookup is cached", cached.urls.length === 1);

  same("the summary says dry when it was", weatherSummary([{ date: "x", basis: "last year", highF: 80.4, lowF: 79.6, rainInches: 0, conditions: "Clear" }]), "Highs 80°F, lows 80°F; dry on these dates last year");

  // ---- errors ----
  check("an unknown airport is refused", /Unknown airport code "ZZZ"/.test(await errorOf(getWeather("ZZZ", "2026-12-11", "2026-12-12", { today }))));
  check("an end before the start is refused", /must be on or after/.test(await errorOf(getWeather("SEA", "2026-12-12", "2026-12-11", { today }))));
  check("a start in the past is refused", /in the past/.test(await errorOf(getWeather("SEA", "2026-11-01", "2026-11-02", { today }))));
  check("more than 21 days is refused", /at most 21 days/.test(await errorOf(getWeather("SEA", "2026-12-01", "2026-12-31", { today }))));
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const outage = await tripWeather("SEA", "2027-03-01", "2027-03-02", { today, fetchImpl: down });
  check(
    "an outage gives 'unavailable' with a reason instead of throwing",
    "unavailable" in outage && /Open-Meteo didn't answer \(fetch failed\)/.test(outage.reason),
    JSON.stringify(outage),
  );

  // ---- presentTrips adds weather to each trip ----
  const request = {
    origin: "Honolulu", destinations: ["Seattle", "Las Vegas"], destinationsFromIdeas: false, departDate: "2026-12-11",
    returnDate: "2026-12-15", travelers: 2, travelersDefaulted: false, budget: 3000, preferences: [], question: null,
  };
  const dates = { departDate: "2026-12-11", returnDate: "2026-12-15" };
  const turns: FakeTurn[] = [
    { calls: [{ name: "recordRequest", args: request }] },
    {
      calls: [
        { name: "searchFlights", args: { origin: "HNL", destination: "SEA", ...dates } },
        { name: "searchHotels", args: { destination: "SEA", checkIn: dates.departDate, checkOut: dates.returnDate } },
        { name: "searchFlights", args: { origin: "HNL", destination: "LAS", ...dates } },
        { name: "searchHotels", args: { destination: "LAS", checkIn: dates.departDate, checkOut: dates.returnDate } },
      ],
    },
    {
      calls: [
        {
          name: "presentTrips",
          args: {
            budget: 3000,
            travelers: 2,
            trips: [
              { flightId: "f001", hotelId: "h002", reason: "Seattle." },
              { flightId: "f021", hotelId: "h031", reason: "Las Vegas." },
            ],
          },
        },
      ],
    },
    { text: "Done." },
  ];
  process.env.FLIGHT_PROVIDER = "mock";
  process.env.HOTEL_PROVIDER = "mock";
  const run = await runAgent([{ role: "user", content: "x" }], undefined, { llm: fakeLlm(turns), today });
  const seattle = run.trips?.find((t) => t.destination === "SEA")?.weather;
  const vegas = run.trips?.find((t) => t.destination === "LAS")?.weather;
  check("a trip gets its stay's weather", Boolean(seattle && "days" in seattle && seattle.days.length === 5 && seattle.basis === LAST_YEAR), JSON.stringify(seattle)?.slice(0, 160));
  check(
    "a trip whose weather can't be found says so, and is still presented",
    Boolean(vegas && "unavailable" in vegas && /no saved weather fixture/.test(vegas.reason)) && run.trips?.length === 2,
    JSON.stringify(vegas),
  );
  const presented = run.trace.find((t) => t.name === "presentTrips")?.result ?? "";
  check("the model sees each trip's weather summary, or 'not found'", /"weather":"Highs/.test(presented) && /"weather":"not found"/.test(presented), presented.slice(0, 300));

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll weather checks passed");
  process.exit(failures ? 1 : 0);
}

function same(name: string, actual: unknown, expected: unknown) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);
}

main();
