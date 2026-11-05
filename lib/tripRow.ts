import type { TripRequest } from "@/agent/recordRequest";
import type { publicRun } from "@/agent/runStore";
import { daysBetween, formatDay, formatDayRange, formatDuration, formatMoney, formatTime, plural } from "./format";

// Turns saved trip fields into the text a results row shows. The row component only displays these values,
// so every number on screen comes from a field of the saved run (no parsing of the agent's prose).

export type PublicRun = ReturnType<typeof publicRun>;
export type PublicTrip = NonNullable<PublicRun["trips"]>[number];

export type BudgetTone = "success" | "warning";

export type RowView = {
  tripId: string;
  bestMatch: boolean;
  /** Where the trip goes, e.g. "Las Vegas". */
  place: string;
  departDay: string;
  /** "11:10 PM – 7:05 AM", or null when the data has no times. */
  times: string | null;
  /** "+1" when the flight lands on a later day. */
  arriveOffset: string | null;
  from: { code: string; name?: string };
  to: { code: string; name?: string };
  /** "Nonstop", "1 stop", "2 stops". */
  stops: string;
  /** "2h 06m at LAX", or null when the data has no layover details. */
  layovers: string | null;
  duration: string | null;
  airline: string | null;
  flightNumbers: string | null;
  redEye: boolean;
  /** "Return Mon, Dec 14", or null when the return date is unknown. */
  returnDay: string | null;
  hotel: { name: string; area?: string; nightly: string; nights: string };
  total: string;
  travelers: string;
  budget: { text: string; tone: BudgetTone };
  reason: string;
};

const unique = <T>(items: T[]) => [...new Set(items)];

export function toRowView(trip: PublicTrip, request: TripRequest | null): RowView {
  const { flight, hotel, totals } = trip;
  const offset = flight.arriveDate ? daysBetween(flight.departDate, flight.arriveDate) : 0;
  const airlines = unique(flight.segments.map((s) => s.airline).filter((a): a is string => !!a));
  const numbers = unique(flight.segments.map((s) => s.flightNumber).filter((n): n is string => !!n));
  const layovers = flight.layovers
    .map((l) => (l.minutes === undefined ? `at ${l.airport}` : `${formatDuration(l.minutes)} at ${l.airport}`))
    .join(", ");
  const returnDate = request?.returnDate ?? hotel.checkOut;
  const gap = Math.abs(totals.difference);

  return {
    tripId: trip.tripId,
    bestMatch: trip.bestMatch,
    place: hotel.city || flight.destinationAirport || trip.destination,
    departDay: formatDay(flight.departDate),
    times: flight.departTime && flight.arriveTime ? `${formatTime(flight.departTime)} – ${formatTime(flight.arriveTime)}` : null,
    arriveOffset: offset > 0 ? `+${offset}` : null,
    from: { code: flight.origin, name: flight.originAirport },
    to: { code: flight.destination, name: flight.destinationAirport },
    stops: flight.stops === 0 ? "Nonstop" : plural(flight.stops, "stop"),
    layovers: layovers || null,
    duration: flight.durationMinutes === undefined ? null : formatDuration(flight.durationMinutes),
    airline: airlines.length ? airlines.join(", ") : (flight.airline ?? null),
    flightNumbers: numbers.length ? numbers.join(", ") : (flight.flightNumber ?? null),
    redEye: flight.redEye,
    returnDay: returnDate ? `Return ${formatDay(returnDate)}` : null,
    hotel: {
      name: hotel.name,
      area: hotel.area,
      nightly: `${formatMoney(hotel.pricePerNight)}/night`,
      nights: plural(hotel.nights, "night"),
    },
    total: formatMoney(totals.total),
    travelers: `total for ${plural(trip.travelers, "traveler")}`,
    budget: trip.withinBudget
      ? { text: gap === 0 ? "Exactly on budget" : `${formatMoney(gap)} under budget`, tone: "success" }
      : { text: `${formatMoney(gap)} over budget`, tone: "warning" },
    reason: trip.reason,
  };
}

/** The search in one line, e.g. "HNL → LAS · Dec 11–14 · 2 travelers · $1,400 budget". Parts that are unknown are left out. */
export function requestSummary(request: TripRequest | null, trips: PublicTrip[]): string[] {
  const origin = trips[0]?.flight.origin ?? request?.origin;
  const places = trips.length ? unique(trips.map((t) => t.destination)) : (request?.destinations ?? []);
  const parts: string[] = [];
  if (origin && places.length) parts.push(`${origin} → ${places.join(", ")}`);
  if (request?.departDate && request.returnDate) parts.push(formatDayRange(request.departDate, request.returnDate));
  if (request) parts.push(plural(request.travelers, "traveler"));
  if (request?.budget) parts.push(`${formatMoney(request.budget)} budget`);
  return parts;
}
