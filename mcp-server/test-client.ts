// Run with: npx tsx mcp-server/test-client.ts
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", path.join(import.meta.dirname, "server.ts")],
});
const client = new Client({ name: "smarttrip-test", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const calls: [string, Record<string, unknown>][] = [
  ["searchFlights", { origin: "hnl", destination: "SEA", departDate: "2026-11-14", returnDate: "2026-11-20" }],
  ["searchFlights", { origin: "HNL", destination: "PDX", departDate: "2026-11-14", returnDate: "2026-11-20" }],
  ["checkBudget", { budget: 500, flightCost: 310 }],
  ["checkBudget", { budget: 500, flightCost: 520 }],
  // Invalid inputs
  ["searchFlights", { origin: "HNL", destination: "SEA", departDate: "2026-11-20", returnDate: "2026-11-14" }],
  ["searchFlights", { origin: "SEA", destination: "LAX", departDate: "2026-11-14", returnDate: "2026-11-20" }],
  ["checkBudget", { budget: 0, flightCost: -5 }],
];

for (const [name, args] of calls) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("");
  console.log(`\n${name} ${JSON.stringify(args)}\n${result.isError ? "ERROR: " : ""}${text}`);
}

await client.close();
