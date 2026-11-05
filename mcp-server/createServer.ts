import { McpServer } from "@modelcontextprotocol/server";
import type { RunContext } from "./lib/runContext";
import { registerCheckBudget } from "./tools/checkBudget";
import { registerEstimateTransport } from "./tools/estimateTransport";
import { registerGetWeather } from "./tools/getWeather";
import { registerLookupAirport } from "./tools/lookupAirport";
import { registerPresentTrips } from "./tools/presentTrips";
import { registerSearchFlights } from "./tools/searchFlights";
import { registerSearchHotels } from "./tools/searchHotels";

/**
 * A server with every SmartTrip tool registered. Used over stdio (server.ts) and in-process by runAgent.
 * `ctx` holds this run's state, such as its SerpApi call count.
 */
export function createServer(ctx: RunContext) {
  const server = new McpServer({ name: "smarttrip", version: "0.2.0" }, { capabilities: { tools: {} } });
  registerLookupAirport(server);
  registerSearchFlights(server, ctx);
  registerSearchHotels(server, ctx);
  registerEstimateTransport(server);
  registerCheckBudget(server);
  registerGetWeather(server, ctx);
  registerPresentTrips(server, ctx);
  return server;
}
