import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { jsonResult, roundMoney, toolError } from "../lib/results";

export const checkBudgetInput = z.object({
  budget: z
    .number()
    .positive("budget must be greater than 0 (USD).")
    .describe("Total trip budget in USD for all travelers. Must be > 0."),
  flightCost: z
    .number()
    .nonnegative("flightCost must be 0 or more (USD).")
    .describe("PER-PERSON flight price in USD: pass searchFlights `price` as is. It is multiplied by travelers."),
  travelers: z
    .number()
    .int("travelers must be a whole number.")
    .min(1, "travelers must be at least 1.")
    .describe("Number of people traveling (whole number, >= 1)."),
  hotelCostPerNight: z
    .number()
    .nonnegative("hotelCostPerNight must be 0 or more (USD).")
    .optional()
    .describe("Hotel price per night in USD for the whole room (searchHotels `pricePerNight`). Give together with nights, or omit both."),
  nights: z
    .number()
    .int("nights must be a whole number.")
    .min(1, "nights must be at least 1.")
    .optional()
    .describe("Number of hotel nights (searchHotels `nights`). Give together with hotelCostPerNight, or omit both."),
  transportCost: z
    .number()
    .nonnegative("transportCost must be 0 or more (USD).")
    .default(0)
    .describe("TOTAL ground transport cost in USD for the whole group (estimateTransport `estimatedCost`). Defaults to 0."),
});

export type CheckBudgetInput = z.output<typeof checkBudgetInput>;

/** Throws an Error with an actionable message when hotelCostPerNight and nights aren't paired. */
export function checkBudget(input: CheckBudgetInput) {
  const hasRate = input.hotelCostPerNight !== undefined;
  const hasNights = input.nights !== undefined;
  if (hasRate !== hasNights) {
    throw new Error(
      hasRate
        ? "hotelCostPerNight was given without nights. Pass both (nights from searchHotels) or omit both."
        : "nights was given without hotelCostPerNight. Pass both (pricePerNight from searchHotels) or omit both.",
    );
  }

  const flights = roundMoney(input.flightCost * input.travelers);
  const hotel = roundMoney((input.hotelCostPerNight ?? 0) * (input.nights ?? 0));
  const transport = roundMoney(input.transportCost);
  const total = roundMoney(flights + hotel + transport);
  return {
    withinBudget: total <= input.budget,
    total,
    overage: roundMoney(Math.max(0, total - input.budget)),
    breakdown: { flights, hotel, transport },
  };
}

export function registerCheckBudget(server: McpServer) {
  server.registerTool(
    "checkBudget",
    {
      title: "Check trip budget",
      description:
        "Total the trip and compare it to the budget. flightCost is PER PERSON and is multiplied by travelers; " +
        "hotelCostPerNight is per room per night and is multiplied by nights; transportCost and budget are TOTALS. " +
        "Returns { withinBudget, total, overage, breakdown: { flights, hotel, transport } } in USD, rounded to cents. " +
        "overage is 0 when within budget; when it is > 0, use breakdown to pick a cheaper flight or hotel and check again.",
      inputSchema: checkBudgetInput,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        return jsonResult(checkBudget(input));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
