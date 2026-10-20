import path from "node:path";
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { registerCheckBudget } from "./tools/checkBudget";
import { registerEstimateTransport } from "./tools/estimateTransport";
import { registerLookupAirport } from "./tools/lookupAirport";
import { registerSearchFlights } from "./tools/searchFlights";
import { registerSearchHotels } from "./tools/searchHotels";

const root = path.resolve(import.meta.dirname, "..");
// quiet: stdout is the MCP protocol channel, so nothing else may print to it.
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

function createServer() {
  const server = new McpServer({ name: "smarttrip", version: "0.2.0" }, { capabilities: { tools: {} } });
  registerLookupAirport(server);
  registerSearchFlights(server);
  registerSearchHotels(server);
  registerEstimateTransport(server);
  registerCheckBudget(server);
  return server;
}

serveStdio(createServer, { onerror: (err) => console.error(err) });
