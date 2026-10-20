// Usage: npm run plan -- <budget> "<notes>"
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(import.meta.dirname, "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

const PROVIDER = process.env.OPENROUTER_API_KEY
  ? {
      name: "OpenRouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      keyVar: "OPENROUTER_API_KEY",
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-nano",
      headers: { "X-Title": "SmartTrip" },
    }
  : {
      name: "course LLM gateway",
      baseURL: process.env.LLM_BASE_URL ?? "https://128.171.10.80:9443/v1",
      apiKey: process.env.LLM_API_KEY,
      keyVar: "LLM_API_KEY",
      model: process.env.LLM_DEFAULT_MODEL ?? "gpt-oss-120b",
      headers: {},
    };
const MODEL = PROVIDER.model;
const TRIP_TOOLS = new Set(["lookupAirport", "searchFlights", "searchHotels", "estimateTransport", "checkBudget"]);
// Each step re-sends the whole conversation, so cap it to protect the budget.
const MAX_STEPS = 14;

const today = new Date().toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You are SmartTrip, a trip planner. The user gives a budget in USD and free-form notes.
Today is ${today}. Dates without a year mean the next time that date comes around.

This runs unattended: never ask the user a question. Make reasonable choices, state any assumptions, and finish with a plan.

Steps (call tools that don't depend on each other in the same turn):
1. From the notes, work out origin, destination, dates, and number of travelers (default 1). If a place is given as a city name, call lookupAirport to get its code.
2. Call searchFlights and searchHotels together (checkIn = departDate, checkOut = returnDate).
3. Pick the flight and hotel that best match the notes, then call estimateTransport with that hotel's milesToAirport and the travelers.
4. Call checkBudget with: flightCost = the flight's price as is (it is per person), travelers, hotelCostPerNight and nights from searchHotels, transportCost = estimatedCost.
5. If overage > 0, change ONE thing to the next cheaper option that is closest to the notes (nonstop -> 1 stop, not straight to 2 stops; or a slightly cheaper hotel in a similar area), call estimateTransport again if the hotel changed, then call checkBudget again. Repeat until withinBudget is true.
6. Only if even the cheapest flight and hotel don't fit, say so and give that cheapest total.

Rules:
- Treat preferences in the notes (stops, location, comfort) as requirements. Check the preferred options with checkBudget first; relax a preference only after checkBudget shows they don't fit, and say which one you relaxed.
- Describe flights and hotels exactly as the tool results do. "stops": 0 is nonstop; anything else is not.
- Quote totals and overages from checkBudget. Any other number must be a tool value or a sum or difference of tool values. Use only flights and hotels returned by the tools.

Write the final answer exactly as the itinerary format below describes.`;

const FORMAT_FILE = path.join(root, "mcp-server/prompts/itinerary-format.md");

function loadSystemPrompt(): string {
  try {
    return `${SYSTEM_PROMPT}\n\n${readFileSync(FORMAT_FILE, "utf8").trim()}`;
  } catch {
    console.error(`Can't read the itinerary format at ${path.relative(root, FORMAT_FILE)}.`);
    process.exit(1);
  }
}

function parseArgs() {
  const [budgetArg, ...noteParts] = process.argv.slice(2);
  const budget = Number(budgetArg);
  const notes = noteParts.join(" ").trim();
  if (!Number.isFinite(budget) || budget <= 0 || !notes) {
    console.error('Usage: npm run plan -- <budget> "<notes>"');
    console.error('  e.g. npm run plan -- 1500 "2 of us, Honolulu to Seattle Nov 14-18, want to walk everywhere"');
    process.exit(1);
  }
  return { budget, notes };
}

function summarize(text: string, isError: boolean): string {
  if (isError) return `error: ${text}`;
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.results) && data.results[0]?.code) {
      return data.results.map((r: { code: string; city: string }) => `${r.code} (${r.city})`).join(", ");
    }
    if (Array.isArray(data.results)) {
      const prices = data.results.map((r: { price?: number; pricePerNight?: number }) => r.price ?? r.pricePerNight);
      const unit = "nights" in data ? `/night, ${data.nights} nights` : "/person";
      const source = data.source ? ` [${data.source}]` : "";
      return `${data.count} found, $${Math.min(...prices)}-$${Math.max(...prices)}${unit}${source}`;
    }
    if ("estimatedCost" in data) {
      return `~$${data.estimatedCost} ${data.method}, ${data.vehicles} vehicle(s)`;
    }
    if ("withinBudget" in data) {
      const b = data.breakdown ?? {};
      const parts = `flights $${b.flights}, hotel $${b.hotel}, transport $${b.transport}`;
      return data.withinBudget
        ? `fits: total $${data.total} (${parts})`
        : `over budget by $${data.overage}: total $${data.total} (${parts})`;
    }
  } catch {
  }
  return text.slice(0, 120);
}

async function main() {
  const { budget, notes } = parseArgs();
  const systemPrompt = loadSystemPrompt();
  if (!PROVIDER.apiKey) {
    console.error("No API key. Add OPENROUTER_API_KEY (or LLM_API_KEY for the course gateway) to .env.local.");
    process.exit(1);
  }
  const llm = new OpenAI({
    baseURL: PROVIDER.baseURL,
    apiKey: PROVIDER.apiKey,
    defaultHeaders: PROVIDER.headers,
    timeout: 60_000,
    maxRetries: 1,
  });

  const mcp = new Client({ name: "smarttrip-planner", version: "0.1.0" });
  await mcp.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", path.join(root, "mcp-server/server.ts")],
      // The transport only passes a minimal env, so forward the flight data source explicitly.
      env: process.env.FLIGHT_PROVIDER ? { FLIGHT_PROVIDER: process.env.FLIGHT_PROVIDER } : {},
    }),
  );

  try {
    const { tools } = await mcp.listTools();
    const llmTools: OpenAI.Chat.ChatCompletionTool[] = tools
      .filter((t) => TRIP_TOOLS.has(t.name))
      .map((t) => {
        const { $schema: _, ...parameters } = t.inputSchema as Record<string, unknown>;
        return { type: "function", function: { name: t.name, description: t.description, parameters } };
      });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Budget: $${budget}\nNotes: ${notes}` },
    ];

    for (let step = 1; step <= MAX_STEPS; step++) {
      console.error(`\nstep ${step}: asking ${MODEL} via ${PROVIDER.name}...`);
      const response = await llm.chat.completions.create({
        model: MODEL,
        messages,
        tools: llmTools,
      });
      const message = response.choices[0].message;
      messages.push(message);

      if (!message.tool_calls?.length) {
        console.log(`\n${message.content ?? "(no answer)"}`);
        return;
      }

      for (const call of message.tool_calls) {
        if (call.type !== "function") continue;
        const { name, arguments: rawArgs } = call.function;
        let text: string;
        try {
          const result = await mcp.callTool({ name, arguments: JSON.parse(rawArgs) });
          text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
          console.error(`  ${result.isError ? "x" : "-"} ${name} ${rawArgs}`);
          console.error(`      ${summarize(text, result.isError === true)}`);
        } catch (err) {
          // Bad JSON from the model: send the error back so it can retry.
          text = `Could not call ${name}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`  x ${name} ${rawArgs}`);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      }
    }
    console.error(`\nStopped after ${MAX_STEPS} steps without a final plan. Try clearer notes or a bigger budget.`);
    process.exitCode = 1;
  } catch (err) {
    if (err instanceof OpenAI.APIConnectionError) {
      console.error(`Can't reach ${PROVIDER.name} (${err.message}). Check your network/VPN, then retry.`);
    } else if (err instanceof OpenAI.APIError && err.status === 401) {
      console.error(`401: ${PROVIDER.keyVar} is wrong, expired, or was regenerated.`);
    } else if (err instanceof OpenAI.APIError && err.status === 402) {
      console.error("402: out of OpenRouter credits. Add credits or pick a cheaper model with OPENROUTER_MODEL.");
    } else if (err instanceof OpenAI.APIError && err.status === 429) {
      console.error(
        PROVIDER.name === "OpenRouter"
          ? "429: OpenRouter rate limit. Wait a minute and retry."
          : "429: course budget is used up. Retrying won't help — ask the instructor/TA.",
      );
    } else if (err instanceof OpenAI.APIError && err.status === 400) {
      console.error(`400: ${PROVIDER.name} rejected the request for "${MODEL}": ${err.message.split("\n")[0]}`);
    } else if (err instanceof OpenAI.APIError && err.status === 404) {
      console.error(`404: model "${MODEL}" not found on ${PROVIDER.name}. Check the model ID.`);
    } else {
      throw err;
    }
    process.exitCode = 1;
  } finally {
    await mcp.close();
  }
}

main();
