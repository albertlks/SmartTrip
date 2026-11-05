import type { TripRequest } from "@/agent/recordRequest";
import type { publicRun } from "@/agent/runStore";
import { daysBetween, formatDay, formatDuration, formatMoney, formatTime, plural } from "./format";
import { freshness, type Freshness } from "./freshness";
import { weatherHint } from "./weatherView";

// Turns saved trip fields into the text a results row shows. The row component only displays these values,
// so every number on screen comes from a field of the saved run (no parsing of the agent's prose).

export type PublicRun = ReturnType<typeof publicRun>;
export type PublicTrip = NonNullable<PublicRun["trips"]>[number];

export type BudgetTone = "success" | "warning";

/** How a flight reads on screen: shared by results rows, the trip page, and return options. */
export type FlightSummary = {
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
};

export type RowView = FlightSummary & {
  tripId: string;
  bestMatch: boolean;
  /** Where the trip goes, e.g. "Las Vegas" (not the hotel's suburb, like "SeaTac"). */
  place: string;
  /** "Return Mon, Dec 14", or null when the return date is unknown. */
  returnDay: string | null;
  hotel: { name: string; area?: string; nightly: string; nights: string };
  /** "Highs 53–58°F", or null without weather. */
  weather: string | null;
  /** Where the flight and the hotel came from ("Live", "Cached 3h ago", "Saved search", "Sample data"). */
  sources: { flight: Freshness; hotel: Freshness };
  total: string;
  travelers: string;
  budget: { text: string; tone: BudgetTone };
  reason: string;
};

const unique = <T>(items: T[]) => [...new Set(items)];

type SummaryFields = Pick<
  PublicTrip["flight"],
  | "departDate" | "departTime" | "arriveDate" | "arriveTime" | "origin" | "originAirport" | "destination" | "destinationAirport"
  | "stops" | "segments" | "layovers" | "durationMinutes" | "airline" | "flightNumber" | "redEye"
>;

export function flightSummary(flight: SummaryFields): FlightSummary {
  const offset = flight.arriveDate ? daysBetween(flight.departDate, flight.arriveDate) : 0;
  const airlines = unique(flight.segments.map((s) => s.airline).filter((a): a is string => !!a));
  const numbers = unique(flight.segments.map((s) => s.flightNumber).filter((n): n is string => !!n));
  const layovers = flight.layovers
    .map((l) => (l.minutes === undefined ? `at ${l.airport}` : `${formatDuration(l.minutes)} at ${l.airport}`))
    .join(", ");
  return {
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
  };
}

/** "$529 under budget" in green, or "$120 over budget" in amber. */
export function budgetLabel(withinBudget: boolean, difference: number): { text: string; tone: BudgetTone } {
  const gap = Math.abs(difference);
  return withinBudget
    ? { text: gap === 0 ? "Exactly on budget" : `${formatMoney(gap)} under budget`, tone: "success" }
    : { text: `${formatMoney(gap)} over budget`, tone: "warning" };
}

/** cityName is the destination airport's city (looked up on the server); the hotel's city is the fallback. */
export function toRowView(trip: PublicTrip, request: TripRequest | null, cityName?: string, now = Date.now()): RowView {
  const { flight, hotel, totals } = trip;
  const returnDate = request?.returnDate ?? hotel.checkOut;
  return {
    ...flightSummary(flight),
    tripId: trip.tripId,
    bestMatch: trip.bestMatch,
    place: placeName(trip, cityName),
    returnDay: returnDate ? `Return ${formatDay(returnDate)}` : null,
    hotel: {
      name: hotel.name,
      area: hotel.area,
      nightly: `${formatMoney(hotel.pricePerNight)}/night`,
      nights: plural(hotel.nights, "night"),
    },
    weather: weatherHint(trip.weather) && `Highs ${weatherHint(trip.weather)}`,
    sources: {
      flight: freshness(flight.source, flight.cache, flight.fetchedAt, now),
      hotel: freshness(hotel.source, hotel.cache, hotel.fetchedAt, now),
    },
    total: formatMoney(totals.total),
    travelers: `total for ${plural(trip.travelers, "traveler")}`,
    budget: budgetLabel(trip.withinBudget, totals.difference),
    reason: trip.reason,
  };
}

/** The destination city: the airport's city when known, else the hotel's. */
export const placeName = (trip: PublicTrip, cityName?: string) =>
  cityName || trip.hotel.city || trip.flight.destinationAirport || trip.destination;
