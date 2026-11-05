import { checkBudget } from "../tools/checkBudget";
import { estimateTransport } from "../tools/estimateTransport";
import type { HotelRecord } from "./data";
import type { FlightRecord } from "./flightProviders";
import type { Source } from "./providers";
import { ToolFailure } from "./results";
import type { RunContext } from "./runContext";

/** One package the agent proposes: ids from this run's searches, and why it fits. */
export type TripChoice = { flightId: string; hotelId: string; activityIds?: string[]; reason: string };

export type TripTotals = {
  /** Round-trip fare per person x travelers. */
  flights: number;
  hotel: number;
  /** Rough rideshare estimate between the airport and the hotel, both ways. */
  transport: number;
  activityAllowance: number;
  total: number;
  budget: number;
  /** budget - total: positive is under budget, negative is over. */
  difference: number;
};

/** A complete trip as the results and detail pages show it. Every number is computed here, never by the model. */
export type Trip = {
  tripId: string;
  rank: number;
  bestMatch: boolean;
  reason: string;
  destination: string;
  travelers: number;
  flight: FlightRecord;
  hotel: HotelRecord;
  /** Filled in once searchActivities exists. */
  activities: [];
  /** Filled in once getWeather exists. */
  weather: null;
  totals: TripTotals;
  withinBudget: boolean;
  sources: { flight: Source; hotel: Source };
};

const fail = (message: string): never => {
  throw new ToolFailure(message);
};

const STALE_ID_HINT = "Use an id from a search in this conversation, or search again.";

function lookup<K extends "flight" | "hotel">(ctx: RunContext, kind: K, id: string, n: number) {
  const record = ctx.results.get(id);
  if (!record || record.kind !== kind) {
    fail(`Trip ${n}: unknown ${kind}Id "${id}". ${STALE_ID_HINT}`);
  }
  return record as K extends "flight" ? FlightRecord : HotelRecord;
}

/**
 * Builds and ranks trips from the agent's choices. The agent's order is its judgment of best match; the only
 * change is that over-budget trips move after the ones within budget. Throws ToolFailure naming any problem.
 */
export function buildTrips(choices: TripChoice[], budget: number, travelers: number, ctx: RunContext): Trip[] {
  if (ctx.request) {
    if (ctx.request.travelers !== travelers) {
      fail(`travelers is ${travelers}, but the recorded request says ${ctx.request.travelers}. Use the recorded value.`);
    }
    if (ctx.request.budget !== null && ctx.request.budget !== budget) {
      fail(`budget is ${budget}, but the recorded request says ${ctx.request.budget}. Use the recorded value.`);
    }
  }

  const seen = new Set<string>();
  const trips = choices.map((choice, i): Omit<Trip, "tripId" | "rank" | "bestMatch"> => {
    const n = i + 1;
    const flight = lookup(ctx, "flight", choice.flightId, n);
    const hotel = lookup(ctx, "hotel", choice.hotelId, n);
    // Results from earlier turns stay usable, so make sure they were searched for the request's current dates.
    const want = ctx.request;
    if (want?.departDate && want.returnDate) {
      if (flight.departDate !== want.departDate || (flight.returnDate && flight.returnDate !== want.returnDate)) {
        fail(
          `Trip ${n}: flight ${flight.id} was searched for ${flight.departDate} to ${flight.returnDate ?? "?"}, but the request is ` +
            `${want.departDate} to ${want.returnDate}. Search flights again with the request's dates.`,
        );
      }
      if (hotel.checkIn !== want.departDate || hotel.checkOut !== want.returnDate) {
        fail(
          `Trip ${n}: hotel ${hotel.id} was searched for ${hotel.checkIn} to ${hotel.checkOut}, but the request is ` +
            `${want.departDate} to ${want.returnDate}. Search hotels again with the request's dates.`,
        );
      }
    }
    if (flight.destination !== hotel.destination) {
      fail(`Trip ${n}: flight ${flight.id} goes to ${flight.destination} but hotel ${hotel.id} is in ${hotel.destination}. Pair them by destination.`);
    }
    const pair = `${flight.id}+${hotel.id}`;
    if (seen.has(pair)) fail(`Trip ${n} repeats flight ${flight.id} with hotel ${hotel.id}. Offer different packages.`);
    seen.add(pair);
    const unknownActivity = choice.activityIds?.find((id) => !ctx.results.has(id));
    if (unknownActivity) fail(`Trip ${n}: unknown activityId "${unknownActivity}". ${STALE_ID_HINT}`);

    // Live hotels without coordinates are dropped by the search, so this only guards against bad data.
    if (hotel.milesToAirport === undefined) fail(`Trip ${n}: hotel ${hotel.id} has no location, so airport rides can't be estimated. Pick another hotel.`);
    const transport = estimateTransport({ milesToAirport: hotel.milesToAirport!, travelers, roundTrip: true }).estimatedCost;
    const check = checkBudget({
      budget,
      flightCost: flight.price,
      travelers,
      hotelCostPerNight: hotel.pricePerNight,
      nights: hotel.nights,
      transportCost: transport,
    });
    // No activity costs yet: the allowance arrives with searchActivities.
    const activityAllowance = 0;
    return {
      reason: choice.reason,
      destination: flight.destination,
      travelers,
      flight,
      hotel,
      activities: [],
      weather: null,
      totals: {
        flights: check.breakdown.flights,
        hotel: check.breakdown.hotel,
        transport: check.breakdown.transport,
        activityAllowance,
        total: check.total,
        budget,
        difference: Math.round((budget - check.total) * 100) / 100,
      },
      withinBudget: check.withinBudget,
      sources: { flight: flight.source, hotel: hotel.source },
    };
  });

  // Stable: keeps the agent's order inside each group.
  const ranked = [...trips.filter((t) => t.withinBudget), ...trips.filter((t) => !t.withinBudget)];
  return ranked.map((t, i) => ({ ...t, tripId: `t${i + 1}`, rank: i + 1, bestMatch: i === 0 }));
}
