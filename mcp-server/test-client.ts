// Run with: npx tsx mcp-server/test-client.ts
// Never calls SerpApi: serpapi mode is only tested with the key blanked out.
import { spawn } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const SERVER = path.join(import.meta.dirname, "server.ts");
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../data/fixtures");
// An empty cache, so serpapi-mode checks never hit a real cached search.
const EMPTY_CACHE = await mkdtemp(path.join(tmpdir(), "smarttrip-cache-"));
const FLIGHT_FIELDS = ["flightNumber", "originAirport", "destinationAirport", "departTime", "arriveTime"];

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
}

async function connect(env: Record<string, string> = {}) {
  const client = new Client({ name: "smarttrip-test", version: "0.2.0" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", SERVER], env }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: result.isError === true, text, data };
}

// ---- Default (mock) provider ----
const client = await connect();

const { tools } = await client.listTools();
check(`server lists 5 tools (${tools.map((t) => t.name).join(", ")})`, tools.length === 5);

// Chain: 2 travelers, HNL -> SEA, 4 nights.
const airport = await call(client, "lookupAirport", { query: "Seattle" });
const sea = airport.data?.results?.[0]?.code;
check("lookupAirport('Seattle') -> SEA first", sea === "SEA", airport.text);

// Main airport first for multi-airport cities, aliases, accents, and the codes the mock data uses.
const lookups: [string, string][] = [
  ["Portland", "PDX"], ["New York", "JFK"], ["NYC", "JFK"], ["Chicago", "ORD"], ["Maui", "OGG"],
  ["Honolulu", "HNL"], ["Cancun", "CUN"], ["Eugene", "EUG"], ["hnl", "HNL"],
];
for (const [query, code] of lookups) {
  const r = await call(client, "lookupAirport", { query });
  check(`lookupAirport('${query}') -> ${code} first`, r.data?.results?.[0]?.code === code, r.text.slice(0, 200));
}

const flights = await call(client, "searchFlights", {
  origin: "HNL", destination: sea, departDate: "2026-11-14", returnDate: "2026-11-18",
});
const flight = flights.data?.results?.[0];
check("searchFlights HNL->SEA returns results with source 'mock'", !flights.isError && flights.data.source === "mock", flights.text.slice(0, 200));
check(
  "every flight result has the section 2 fields",
  !flights.isError && flights.data.results.every((r: any) => FLIGHT_FIELDS.every((f) => typeof r[f] === "string")),
);

const hotels = await call(client, "searchHotels", { destination: "SEA", checkIn: "2026-11-14", checkOut: "2026-11-18" });
const hotel = hotels.data?.results?.[0];
check(
  "searchHotels SEA -> 4 nights, cheapest first, stayTotal = price x nights",
  hotels.data?.nights === 4 && hotel?.stayTotal === hotel?.pricePerNight * 4 &&
    hotels.data.results.every((h: any, i: number, a: any[]) => i === 0 || a[i - 1].pricePerNight <= h.pricePerNight),
  hotels.text.slice(0, 200),
);

const transport = await call(client, "estimateTransport", { milesToAirport: hotel?.milesToAirport, travelers: 2 });
const expectedTransport = (8 + 2.5 * hotel?.milesToAirport) * 2;
check(`estimateTransport -> round trip, 1 vehicle ($${expectedTransport})`, transport.data?.estimatedCost === expectedTransport && transport.data?.vehicles === 1, transport.text);

const budget = await call(client, "checkBudget", {
  budget: 2000, flightCost: flight?.price, travelers: 2,
  hotelCostPerNight: hotel?.pricePerNight, nights: hotels.data?.nights, transportCost: transport.data?.estimatedCost,
});
const expectedTotal = flight?.price * 2 + hotel?.pricePerNight * 4 + transport.data?.estimatedCost;
check(`checkBudget chain total = flights x2 + hotel x4 + transport ($${expectedTotal})`, budget.data?.total === expectedTotal, budget.text);

// Regression: flightCost is per person.
const doubled = await call(client, "checkBudget", { budget: 1000, flightCost: 385, travelers: 2 });
check("checkBudget doubles a per-person flight for 2 travelers (385 -> 770)", doubled.data?.breakdown?.flights === 770 && doubled.data?.total === 770, doubled.text);

const vehicles = await call(client, "estimateTransport", { milesToAirport: 10, travelers: 5, roundTrip: false });
check("estimateTransport: 5 travelers -> 2 vehicles, one way", vehicles.data?.vehicles === 2 && vehicles.data?.estimatedCost === 66, vehicles.text);

// Invalid inputs: each must be a clear toolError, not a crash.
const invalid: [string, string, Record<string, unknown>, RegExp][] = [
  ["bad airport code", "searchFlights", { origin: "HNL", destination: "SEATTLE", departDate: "2026-11-14", returnDate: "2026-11-18" }, /3-letter IATA airport code/],
  ["checkOut before checkIn", "searchHotels", { destination: "SEA", checkIn: "2026-11-18", checkOut: "2026-11-14" }, /checkOut .* must be after checkIn/],
  ["nights without hotelCostPerNight", "checkBudget", { budget: 1000, flightCost: 300, travelers: 1, nights: 3 }, /nights was given without hotelCostPerNight/],
  ["no matching airport", "lookupAirport", { query: "Atlantis" }, /No airport found for "Atlantis"/],
  ["unknown route", "searchFlights", { origin: "SEA", destination: "LAX", departDate: "2026-11-14", returnDate: "2026-11-18" }, /Routes with flights:/],
  ["hotel destination with no hotels", "searchHotels", { destination: "LAX", checkIn: "2026-11-14", checkOut: "2026-11-18" }, /Destinations with hotels:/],
  ["zero travelers", "estimateTransport", { milesToAirport: 5, travelers: 0 }, /travelers must be at least 1/],
];
for (const [label, tool, args, pattern] of invalid) {
  const r = await call(client, tool, args);
  check(`error: ${label} (${tool})`, r.isError && pattern.test(r.text), r.text);
}
await client.close();

// ---- Fixture provider ----
const fixtures = (await readdir(FIXTURE_DIR).catch(() => [] as string[])).filter((f) => /^serpapi-flights-.*\.json$/.test(f));
const fixtureClient = await connect({ FLIGHT_PROVIDER: "fixture" });
if (fixtures.length === 0) {
  const r = await call(fixtureClient, "searchFlights", { origin: "HNL", destination: "SEA", departDate: "2026-11-14", returnDate: "2026-11-18" });
  check("fixture mode with no saved fixture -> clear toolError", r.isError && /No fixtures are saved yet/.test(r.text), r.text);
  console.log("SKIP  fixture mapping: no file in data/fixtures/ yet (see .env.example for how to save one)");
} else {
  for (const file of fixtures) {
    const [, , origin, destination, ...dates] = file.replace(/\.json$/, "").split("-");
    const departDate = dates.slice(0, 3).join("-");
    const returnDate = dates.slice(3, 6).join("-");
    const r = await call(fixtureClient, "searchFlights", { origin, destination, departDate, returnDate });
    check(`fixture ${file}: source 'fixture' with mapped results`, !r.isError && r.data.source === "fixture" && r.data.count > 0, r.text.slice(0, 300));
    const missing = r.data?.results?.flatMap((x: any) => FLIGHT_FIELDS.filter((f) => !(f in x)).map((f) => `${x.id}.${f}`)) ?? [];
    check(`fixture ${file}: every result has the section 2 fields`, !r.isError && missing.length === 0, missing.join(", "));
  }
}
await fixtureClient.close();

// ---- SerpApi provider without a key (blank key: dotenv won't override it, so no live call) ----
const noKey = await connect({ FLIGHT_PROVIDER: "serpapi", SERPAPI_API_KEY: "", SMARTTRIP_CACHE_DIR: EMPTY_CACHE });
const noKeyResult = await call(noKey, "searchFlights", { origin: "HNL", destination: "SEA", departDate: "2026-11-14", returnDate: "2026-11-18" });
check("serpapi mode without a key -> clear toolError", noKeyResult.isError && /SERPAPI_API_KEY is not set/.test(noKeyResult.text), noKeyResult.text);
await noKey.close();

// ---- stdout carries only MCP protocol messages ----
const stdoutLines = await new Promise<string[]>((resolve) => {
  const child = spawn("npx", ["tsx", SERVER], { env: { ...process.env, FLIGHT_PROVIDER: "serpapi", SERPAPI_API_KEY: "", SMARTTRIP_CACHE_DIR: EMPTY_CACHE } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "searchFlights", arguments: { origin: "HNL", destination: "SEA", departDate: "2026-11-14", returnDate: "2026-11-18" } } });
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "checkBudget", arguments: { budget: 100, flightCost: 50, travelers: 1, nights: 2 } } });
  setTimeout(() => {
    child.kill();
    resolve(out.split("\n").filter((l) => l.trim()));
  }, 6000);
});
const nonProtocol = stdoutLines.filter((l) => {
  try {
    return JSON.parse(l).jsonrpc !== "2.0";
  } catch {
    return true;
  }
});
check(`stdout has only JSON-RPC messages (${stdoutLines.length} lines, 4 responses expected)`, stdoutLines.length === 4 && nonProtocol.length === 0, nonProtocol.join("\n"));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
