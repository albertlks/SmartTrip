import type { TripRequest } from "@/agent/recordRequest";
import type { ReturnOption } from "@/mcp-server/lib/returnFlights";
import { formatMoney, plural } from "./format";
import type { PublicRun, PublicTrip } from "./tripRow";

// What the trip detail page shows besides the flight itself, worked out from saved fields only.

export type CostLine = { label: string; detail: string; amount: number; estimate?: boolean };

/** The trip's total, line by line. The amounts are the saved totals, so they add up to what the results row shows. */
export function costLines(trip: PublicTrip): CostLine[] {
  const { flight, hotel, totals, travelers } = trip;
  const lines: CostLine[] = [
    { label: "Flights", detail: `${formatMoney(flight.price)} round trip × ${plural(travelers, "traveler")}`, amount: totals.flights },
    { label: "Hotel", detail: `${formatMoney(hotel.pricePerNight)}/night × ${plural(hotel.nights, "night")}`, amount: totals.hotel },
    { label: "Airport rides", detail: "Rideshare to and from the hotel", amount: totals.transport, estimate: true },
  ];
  if (totals.activityAllowance > 0) {
    lines.push({ label: "Activities", detail: "Daily allowance", amount: totals.activityAllowance, estimate: true });
  }
  return lines;
}

/** Plain statements of what the total takes for granted. Each comes from a field, never from the agent's text. */
export function assumptions(trip: PublicTrip, request: TripRequest | null): string[] {
  const list = [
    "Flight prices are round-trip fares per person: the return flight is included.",
    "Airport rides are an estimate for a rideshare between the airport and the hotel, both ways.",
    "Hotel prices may not include taxes and resort fees.",
  ];
  if (request?.travelersDefaulted) list.push("You didn't say how many people are going, so this assumes 1 traveler.");
  if (trip.travelers >= 3) list.push(`The hotel price is for one room; a group of ${trip.travelers} may need more.`);
  if (request?.destinationsFromIdeas) list.push("SmartTrip suggested this destination from its list of popular destinations.");
  if (trip.sources.flight === "mock") list.push("Flights are sample data, not live prices.");
  if (trip.sources.flight === "fixture") list.push("Flights come from a saved Google Flights search, not today's prices.");
  if (trip.sources.hotel === "mock") list.push("Hotels are sample data, not live prices.");
  if (trip.sources.hotel === "fixture") list.push("Hotels come from a saved Google Hotels search, not today's prices.");
  return list;
}

type TraceEntry = PublicRun["trace"][number];

/** One line on what a tool call did, e.g. "8 flights found", or the start of its error. */
export function traceSummary(entry: TraceEntry): string {
  if (entry.isError) {
    const first = entry.result.split("\n")[0];
    return first.length > 160 ? `${first.slice(0, 157)}…` : first;
  }
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(entry.result) as Record<string, unknown>;
  } catch {
    return "Done";
  }
  const count = (key: string) => (Array.isArray(result[key]) ? (result[key] as unknown[]).length : undefined);
  switch (entry.name) {
    case "recordRequest": {
      const missing = Array.isArray(result.missing) ? (result.missing as string[]) : [];
      return missing.length ? `Recorded the request; missing ${missing.join(", ")}` : "Recorded the request";
    }
    case "searchFlights":
      return plural(Number(result.count ?? count("results") ?? 0), "flight") + " found";
    case "searchHotels":
      return plural(Number(result.count ?? count("results") ?? 0), "hotel") + " found";
    case "lookupAirport":
      return plural(count("results") ?? 0, "airport") + " found";
    case "presentTrips":
      return `${plural(count("trips") ?? 0, "trip")} ranked and totaled`;
    default:
      return "Done";
  }
}

/** Pretty-printed arguments, or the raw text when the model sent invalid JSON. */
export function traceArgs(entry: TraceEntry): string {
  try {
    return JSON.stringify(JSON.parse(entry.args), null, 2);
  } catch {
    return entry.args;
  }
}

/**
 * A return option's price against the fare already in the total. SerpApi prices each return as the round-trip fare
 * for the pair, so the cheapest usually equals it.
 */
export function returnPriceLabel(option: Pick<ReturnOption, "price">, includedFare: number): { text: string; included: boolean } {
  const diff = option.price - includedFare;
  if (diff === 0) return { text: "Included in your total", included: true };
  return diff > 0
    ? { text: `+${formatMoney(diff)} per person`, included: false }
    : { text: `${formatMoney(-diff)} less per person`, included: false };
}

export type ReturnMode = "saved" | "auto" | "click";

/**
 * When the trip page loads return flights: already saved, or free to fetch (fixture or sample flights) loads on open;
 * a live flight waits for a click, so opening a trip never spends a SerpApi search by itself.
 */
export function returnMode(run: PublicRun, trip: PublicTrip): ReturnMode {
  if (run.returns?.[trip.tripId]) return "saved";
  return trip.flight.source === "serpapi" ? "click" : "auto";
}
