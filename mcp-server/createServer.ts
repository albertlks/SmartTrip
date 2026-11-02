import { McpServer } from "@modelcontextprotocol/server";
import type { RunContext } from "./lib/runContext";
import { registerCheckBudget } from "./tools/checkBudget";
import { registerEstimateTransport } from "./tools/estimateTransport";
import { registerLookupAirport } from "./tools/lookupAirport";
import { registerSearchFlights } from "./tools/searchFlights";
import { registerSearchHotels } from "./tools/searchHotels";

/**
 * A server with every SmartTrip tool registered. Used over stdio (server.ts) and in-process by runAgent.
 * The tools don't read `ctx` yet; the SerpApi cap and presentTrips' result store will.
 */
export function createServer(ctx: RunContext) {
  const server = new McpServer({ name: "smarttrip", version: "0.2.0" }, { capabilities: { tools: {} } });
  registerLookupAirport(server);
  registerSearchFlights(server);
  registerSearchHotels(server);
  registerEstimateTransport(server);
  registerCheckBudget(server);
  return server;
}
