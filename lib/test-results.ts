// Run with: npx tsx lib/test-results.ts
// No network: checks the results page's formatting and the row view built from a saved trip.
// Hawaii time, where a UTC slip would show Dec 11 as Dec 10.
process.env.TZ = "Pacific/Honolulu";

import type { TripRequest } from "@/agent/recordRequest";
import { formatDay, formatDayRange, formatDuration, formatMoney, formatTime } from "./format";
import { requestSummary, toRowView, type PublicTrip } from "./tripRow";

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
same("the place is the hotel's city", row.place, "Las Vegas");

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

// ---- summary line ----
same("the summary line lists route, dates, travelers, and budget", requestSummary(request, [redEye]), [
  "HNL → LAS",
  "Dec 11–14",
  "2 travelers",
  "$1,400 budget",
]);
same("a run without a request or trips has no summary", requestSummary(null, []), []);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll results checks passed");
process.exit(failures ? 1 : 0);
