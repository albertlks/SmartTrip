// Run with: npx tsx lib/test-results.ts
// No network: checks the results page's formatting and the row view built from a saved trip.
// Hawaii time, where a UTC slip would show Dec 11 as Dec 10.
process.env.TZ = "Pacific/Honolulu";

import type { TripRequest } from "@/agent/recordRequest";
import { formatDay, formatDayRange, formatDuration, formatMoney, formatTime } from "./format";
import { editMessage, editStart, parseEdit, toChips } from "./requestChips";
import { iconFor, weatherHint, weatherView } from "./weatherView";
import { assumptions, costLines, returnMode, returnPriceLabel, traceArgs, traceSummary } from "./tripDetail";
import { toRowView, type PublicRun, type PublicTrip } from "./tripRow";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
}
const same = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

// ---- formatting ----
same("whole dollars have no cents", formatMoney(1500), "$1,500");
same("cents show when there are some", formatMoney(1249.5), "$1,249.50");
same("durations show hours and padded minutes", formatDuration(126), "2h 06m");
same("whole hours drop the minutes", formatDuration(60), "1h");
same("short durations show minutes only", formatDuration(45), "45m");
same("a calendar date keeps its day in Hawaii", formatDay("2026-12-11"), "Fri, Dec 11");
same("a range in one month names it once", formatDayRange("2026-12-11", "2026-12-14"), "Dec 11–14");
same("a range across months names both", formatDayRange("2026-12-28", "2027-01-02"), "Dec 28 – Jan 2");
same("evening times use PM", formatTime("23:10"), "11:10 PM");
same("morning times drop the leading zero", formatTime("07:05"), "7:05 AM");
same("just after midnight is 12 AM", formatTime("00:25"), "12:25 AM");
same("noon hour is PM", formatTime("12:40"), "12:40 PM");

// ---- row view ----
const request: TripRequest = {
  origin: "Honolulu",
  destinations: ["Las Vegas"],
  destinationsFromIdeas: false,
  departDate: "2026-12-11",
  returnDate: "2026-12-14",
  travelers: 2,
  travelersDefaulted: false,
  budget: 1400,
  preferences: [],
  question: null,
  missing: [],
};

const redEye: PublicTrip = {
  tripId: "t1",
  rank: 1,
  bestMatch: true,
  reason: "Cheapest combination.",
  destination: "LAS",
  travelers: 2,
  flight: {
    kind: "flight",
    id: "f022",
    source: "mock",
    tripType: "round trip",
    origin: "HNL",
    originAirport: "Honolulu Intl",
    destination: "LAS",
    destinationAirport: "Harry Reid Intl",
    departDate: "2026-12-11",
    returnDate: "2026-12-14",
    departTime: "23:10",
    arriveDate: "2026-12-12",
    arriveTime: "07:05",
    durationMinutes: 354,
    stops: 0,
    segments: [{ airline: "Allegiant", flightNumber: "G4 1251", from: "HNL", to: "LAS" }],
    layovers: [],
    redEye: true,
    airline: "Allegiant",
    flightNumber: "G4 1251",
    price: 330,
  },
  hotel: {
    id: "h032",
    destination: "LAS",
    name: "Desert Palms Motel",
    city: "Las Vegas",
    area: "East of the Strip",
    tier: "budget",
    pricePerNight: 60,
    rating: 3.4,
    milesToAirport: 3,
    milesToDowntown: 5,
    notes: "",
    kind: "hotel",
    source: "mock",
    checkIn: "2026-12-11",
    checkOut: "2026-12-14",
    nights: 3,
    stayTotal: 180,
  },
  activities: [],
  weather: null,
  totals: { flights: 660, hotel: 180, transport: 31, activityAllowance: 0, total: 871, budget: 1400, difference: 529 },
  withinBudget: true,
  sources: { flight: "mock", hotel: "mock" },
};

const row = toRowView(redEye, request);
same("times run from departure to arrival", row.times, "11:10 PM – 7:05 AM");
same("a next-day arrival is marked +1", row.arriveOffset, "+1");
same("the departure day is shown", row.departDay, "Fri, Dec 11");
same("airports keep code and name", [row.from, row.to], [{ code: "HNL", name: "Honolulu Intl" }, { code: "LAS", name: "Harry Reid Intl" }]);
same("nonstop has no layover text", [row.stops, row.layovers], ["Nonstop", null]);
same("total time comes from the flight", row.duration, "5h 54m");
check("the red-eye flag is passed through", row.redEye);
same("airline and flight number come from the segments", [row.airline, row.flightNumbers], ["Allegiant", "G4 1251"]);
same("the return day comes from the request", row.returnDay, "Return Mon, Dec 14");
same("hotel price and nights", [row.hotel.nightly, row.hotel.nights], ["$60/night", "3 nights"]);
same("the total and who it covers", [row.total, row.travelers], ["$871", "total for 2 travelers"]);
same("under budget is good news", row.budget, { text: "$529 under budget", tone: "success" });
same("without the airport's city the place is the hotel's city", row.place, "Las Vegas");
same("the airport's city wins over the hotel's suburb", toRowView({ ...redEye, hotel: { ...redEye.hotel, city: "Paradise" } }, request, "Las Vegas").place, "Las Vegas");

const overBudget = toRowView({ ...redEye, withinBudget: false, totals: { ...redEye.totals, total: 1520, difference: -120 } }, request);
same("over budget is a warning with the gap", overBudget.budget, { text: "$120 over budget", tone: "warning" });

const withStops = toRowView(
  {
    ...redEye,
    flight: {
      ...redEye.flight,
      departTime: undefined,
      arriveTime: undefined,
      arriveDate: undefined,
      stops: 2,
      redEye: false,
      segments: [
        { airline: "United", flightNumber: "UA 1", from: "HNL", to: "LAX" },
        { airline: "United", flightNumber: "UA 2", from: "LAX", to: "SFO" },
        { airline: "Alaska", flightNumber: "AS 3", from: "SFO", to: "LAS" },
      ],
      layovers: [{ airport: "LAX", minutes: 287 }, { airport: "SFO" }],
    },
  },
  null,
);
same("stops are counted", withStops.stops, "2 stops");
same("layovers list duration and airport, or just the airport", withStops.layovers, "4h 47m at LAX, at SFO");
same("airlines and flight numbers list each one once", [withStops.airline, withStops.flightNumbers], ["United, Alaska", "UA 1, UA 2, AS 3"]);
same("missing times show nothing rather than a guess", [withStops.times, withStops.arriveOffset], [null, null]);
same("without a request the return day comes from the hotel stay", withStops.returnDay, "Return Mon, Dec 14");

// ---- request chips ----
const chips = toChips({ ...request, destinationsFromIdeas: true, travelersDefaulted: true, preferences: ["nonstop"] });
same(
  "chips show each field with its value",
  chips.map((c) => `${c.label}: ${c.value}`),
  ["From: Honolulu", "To: Las Vegas", "Dates: Dec 11–14", "Travelers: 2", "Budget: $1,400", "Prefers: nonstop"],
);
same("destinations the agent picked are marked suggested", chips[1].kind === "field" && chips[1].note, "suggested");
same("a default traveler count is marked assumed", chips[3].kind === "field" && chips[3].note, "assumed");
const missing = toChips({ ...request, budget: null, departDate: null });
same(
  "missing fields say so and are flagged",
  missing.filter((c) => c.kind === "field" && c.missing).map((c) => `${c.label}: ${c.value}`),
  ["Dates: Not set", "Budget: Not set"],
);
same("an unset budget starts blank in the editor", editStart("budget", { ...request, budget: null }), { value: "" });

same(
  "a budget edit says what changes and keeps the rest",
  editMessage({ field: "budget", value: 1200 }),
  "Change the total budget to $1,200. Keep everything else the same.",
);
same(
  "a dates edit gives readable and exact dates",
  editMessage({ field: "dates", departDate: "2026-12-12", returnDate: "2026-12-16" }),
  "Change the dates to Dec 12–16, 2026 (depart 2026-12-12, return 2026-12-16). Keep everything else the same.",
);
same(
  "removing a preference names it",
  editMessage({ field: "removePreference", value: "nonstop" }),
  'Drop the preference "nonstop". Keep everything else the same.',
);

same("a budget can be typed with $ and commas", parseEdit("budget", { value: "$1,250" }), { edit: { field: "budget", value: 1250 } });
check("an empty budget is refused", "error" in parseEdit("budget", { value: "" }));
check("a zero budget is refused", "error" in parseEdit("budget", { value: "0" }));
check("0 travelers is refused", "error" in parseEdit("travelers", { value: "0" }));
check("a fraction of a traveler is refused", "error" in parseEdit("travelers", { value: "1.5" }));
same("travelers parse to a number", parseEdit("travelers", { value: "3" }), { edit: { field: "travelers", value: 3 } });
same(
  "a return before departure is refused",
  parseEdit("dates", { departDate: "2026-12-15", returnDate: "2026-12-11" }),
  { error: "The return date must be after the departure date." },
);
check("a missing date is refused", "error" in parseEdit("dates", { departDate: "2026-12-15", returnDate: "" }));
check("a blank destination is refused", "error" in parseEdit("destinations", { value: "   " }));
same("text is trimmed", parseEdit("origin", { value: "  Hilo " }), { edit: { field: "origin", value: "Hilo" } });

// ---- trip detail ----
const lines = costLines(redEye);
same("cost lines are flights, hotel, and airport rides", lines.map((l) => l.label), ["Flights", "Hotel", "Airport rides"]);
same("the cost lines add up to the saved total", lines.reduce((sum, l) => sum + l.amount, 0), redEye.totals.total);
same("flights show fare times travelers", lines[0].detail, "$330 round trip × 2 travelers");
check("airport rides are marked as an estimate", lines[2].estimate === true);
same(
  "an activity allowance appears only when there is one",
  costLines({ ...redEye, totals: { ...redEye.totals, activityAllowance: 80, total: 951 } }).map((l) => l.label).at(-1),
  "Activities",
);

const always = assumptions(redEye, request);
check("assumptions always explain the fare and the ride estimate", always.some((a) => /round-trip fares per person/.test(a)) && always.some((a) => /rideshare/.test(a)));
check("sample data is called sample data", always.some((a) => /Flights are sample data/.test(a)));
check("no traveler assumption when the user said how many", !always.some((a) => /assumes 1 traveler/.test(a)));
const assumedAll = assumptions(
  { ...redEye, travelers: 3, sources: { flight: "fixture", hotel: "mock" } },
  { ...request, travelersDefaulted: true, destinationsFromIdeas: true },
);
check("a default traveler count is stated", assumedAll.some((a) => /assumes 1 traveler/.test(a)));
check("3+ travelers get the one-room caveat", assumedAll.some((a) => /one room; a group of 3/.test(a)));
check("suggested destinations are stated", assumedAll.some((a) => /suggested this destination/.test(a)));
check("fixture flights are called a saved search", assumedAll.some((a) => /saved Google Flights search/.test(a)));

const entry = (name: string, result: string, isError = false) => ({ step: 1, name, args: "{}", isError, result, ms: 3 });
same("a flight search reads as a count", traceSummary(entry("searchFlights", JSON.stringify({ count: 8, results: [] }))), "8 flights found");
same("one hotel is singular", traceSummary(entry("searchHotels", JSON.stringify({ count: 1, results: [{}] }))), "1 hotel found");
same("presentTrips counts trips", traceSummary(entry("presentTrips", JSON.stringify({ trips: [{}, {}] }))), "2 trips ranked and totaled");
same("a recorded request names what's missing", traceSummary(entry("recordRequest", '{"recorded":true,"missing":["budget"]}')), "Recorded the request; missing budget");
same("an error shows its first line", traceSummary(entry("searchFlights", "No flights.\nTry again.", true)), "No flights.");
same("arguments are pretty-printed", traceArgs({ ...entry("x", ""), args: '{"a":1}' }), '{\n  "a": 1\n}');
same("invalid arguments are shown as sent", traceArgs({ ...entry("x", ""), args: "{oops" }), "{oops");

same("the return at the included fare is included", returnPriceLabel({ price: 421 }, 421), { text: "Included in your total", included: true });
same("a dearer return shows the extra per person", returnPriceLabel({ price: 472 }, 421), { text: "+$51 per person", included: false });
same("a cheaper return says so", returnPriceLabel({ price: 400 }, 421), { text: "$21 less per person", included: false });

const runFor = (returns: PublicRun["returns"]) => ({ returns }) as PublicRun;
same("sample and fixture flights load their returns on open", returnMode(runFor(undefined), redEye), "auto");
same(
  "a live flight waits for a click",
  returnMode(runFor(undefined), { ...redEye, flight: { ...redEye.flight, source: "serpapi" } }),
  "click",
);
same(
  "saved returns are shown straight away",
  returnMode(runFor({ t1: { flightId: "f022", source: "serpapi", options: [] } }), { ...redEye, flight: { ...redEye.flight, source: "serpapi" } }),
  "saved",
);

// ---- weather strip ----
const lastYearDay = { date: "2026-12-11", basis: "last year" as const, highF: 54.6, lowF: 44.4, rainInches: 0.583, conditions: "Rain" };
const forecastDay = { date: "2026-11-06", basis: "forecast" as const, highF: 54.2, lowF: 45.9, rainChance: 88, conditions: "Light drizzle" };
const pastWeather = {
  basis: "last year's actuals for the same dates" as const,
  days: [lastYearDay, { ...lastYearDay, date: "2026-12-12", highF: 57.9, rainInches: 0, conditions: "Overcast" }],
  summary: "Highs 55–58°F, lows 44°F; rain on 1 of 2 days last year",
  source: "open-meteo" as const,
  fetchedAt: 0,
};
const past = weatherView(pastWeather);
check("last year's actuals are labelled, with the reason", past.kind === "days" && past.heading === "Last year's actuals for these dates" && /same dates last year/.test(past.note ?? ""));
if (past.kind === "days") {
  same("a last-year day shows rainfall", [past.days[0].rain, past.days[1].rain], ["0.58 in", "Dry"]);
  same("dates and temperatures are short", [past.days[0].weekday, past.days[0].day, past.days[0].high, past.days[0].low], ["Fri", "Dec 11", "55°", "44°"]);
  check(
    "screen readers hear the whole day, including that it's last year's",
    past.days[0].label === "Friday, December 11: Rain, high 55°F, low 44°F, 0.58 inches of rain, last year's actuals for this date",
    past.days[0].label,
  );
  check("cards aren't tagged one by one unless the range is mixed", !past.mixed);
}
const soon = weatherView({ ...pastWeather, basis: "forecast", days: [forecastDay] });
check("a forecast is labelled Forecast, with no note", soon.kind === "days" && soon.heading === "Forecast" && soon.note === null);
same("a forecast day shows its chance of rain", soon.kind === "days" && soon.days[0].rain, "88% rain");
const both = weatherView({ ...pastWeather, basis: "mixed", days: [forecastDay, lastYearDay] });
check("a mixed range says so and tags each card", both.kind === "days" && both.mixed && both.days.map((d) => d.tag).join() === "Forecast,Last year");
same("unavailable weather keeps its reason", weatherView({ unavailable: true, reason: "Open-Meteo didn't answer." }), {
  kind: "unavailable",
  reason: "Open-Meteo didn't answer.",
});
same("runs saved before weather show nothing", weatherView(null), { kind: "none" });
same(
  "conditions pick an icon",
  ["Clear", "Mostly clear", "Partly cloudy", "Overcast", "Fog", "Light drizzle", "Rain showers", "Snow", "Thunderstorm", "Unknown"].map(iconFor),
  ["sun", "sun", "partly", "cloud", "fog", "rain", "rain", "snow", "storm", "unknown"],
);
same("a row's weather hint is the range of highs", weatherHint(pastWeather), "55–58°F");
same("no hint without weather", [weatherHint(null), weatherHint({ unavailable: true, reason: "x" })], [null, null]);
same("rows say Highs before the range", toRowView({ ...redEye, weather: pastWeather }, request).weather, "Highs 55–58°F");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll results checks passed");
process.exit(failures ? 1 : 0);
