import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { jsonResult, roundMoney } from "../lib/results";

export const checkBudgetInput = z.object({
  budget: z.number().positive("budget must be greater than 0 (USD).").describe("Total trip budget in USD. Must be > 0."),
  flightCost: z
    .number()
    .nonnegative("flightCost must be 0 or more (USD).")
    .describe("Flight cost in USD. Pass the `price` from a searchFlights result."),
});

/** Pure budget math, exported separately so it can be tested without MCP. */
export function checkBudget(input: z.output<typeof checkBudgetInput>) {
  const total = roundMoney(input.flightCost);
  return {
    withinBudget: total <= input.budget,
    total,
    overage: roundMoney(Math.max(0, total - input.budget)),
  };
}

export function registerCheckBudget(server: McpServer) {
  server.registerTool(
    "checkBudget",
    {
      title: "Check trip budget",
      description:
        "Compare a flight's cost to the budget. " +
        "Returns { withinBudget, total, overage } in USD, rounded to cents. " +
        "overage is 0 when within budget; when it is > 0, pick a cheaper flight and check again.",
      inputSchema: checkBudgetInput,
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(checkBudget(input)),
  );
}
