import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { jsonResult, roundMoney } from "../lib/results";

// Rough rideshare assumptions for a demo, not real quotes.
const BASE_FARE = 8;
const PER_MILE = 2.5;
const SEATS_PER_VEHICLE = 4;

export const estimateTransportInput = z.object({
  milesToAirport: z
    .number()
    .nonnegative("milesToAirport must be 0 or more.")
    .describe("Distance between the airport and the hotel in miles (searchHotels `milesToAirport`)."),
  travelers: z
    .number()
    .int("travelers must be a whole number.")
    .min(1, "travelers must be at least 1.")
    .describe("Number of people traveling (whole number, >= 1)."),
  roundTrip: z
    .boolean()
    .default(true)
    .describe("true (default) for airport->hotel and back; false for one way."),
});

export function estimateTransport(input: z.output<typeof estimateTransportInput>) {
  const vehicles = Math.ceil(input.travelers / SEATS_PER_VEHICLE);
  const oneWay = (BASE_FARE + PER_MILE * input.milesToAirport) * vehicles;
  return {
    estimatedCost: roundMoney(input.roundTrip ? oneWay * 2 : oneWay),
    method: "rideshare" as const,
    vehicles,
    assumptions: `$${BASE_FARE} base + $${PER_MILE}/mile per vehicle, up to ${SEATS_PER_VEHICLE} riders each${input.roundTrip ? ", round trip" : ", one way"}`,
  };
}

export function registerEstimateTransport(server: McpServer) {
  server.registerTool(
    "estimateTransport",
    {
      title: "Estimate airport transport",
      description:
        "ROUGH ESTIMATE of rideshare cost between the airport and the hotel for the whole group (not a real quote). " +
        "Returns { estimatedCost, method, vehicles, assumptions }. " +
        "estimatedCost is a TOTAL in USD and can be passed straight to checkBudget.transportCost.",
      inputSchema: estimateTransportInput,
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(estimateTransport(input)),
  );
}
