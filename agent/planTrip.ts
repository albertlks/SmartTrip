// Usage: npm run plan -- <budget> "<notes>"
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
const TRIP_TOOLS = new Set(["searchFlights", "checkBudget"]);
// Each step re-sends the whole conversation, so cap it to protect the budget.
const MAX_STEPS = 6;

const today = new Date().toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You are SmartTrip, a trip planner. The user gives a budget in USD and free-form notes.
Today is ${today}. Dates without a year mean the next time that date comes around.

This runs unattended: never ask the user a question. Make reasonable choices, state any assumptions, and finish with a plan.

Steps:
1. Work out origin, destination (3-letter airport codes), and dates from the notes.
2. Call searchFlights.
3. Pick the flight that best matches the notes, then call checkBudget with it.
4. If overage > 0, swap to a cheaper flight and call checkBudget again. Keep going until withinBudget is true.
5. Only if even the cheapest flight doesn't fit, say so and give that cheapest total.

Rules:
- Treat preferences in the notes (stops, airline, timing) as requirements unless the budget makes that impossible; then say which one you relaxed.
- Describe flights exactly as the tool results do. "stops": 0 is nonstop; anything else is not.
- Never state a total you did not get from checkBudget. Use only flights returned by the tools.

Final answer format:
- Flight: airline, flight id, price, stops, why you chose it
- Total vs budget (from checkBudget), and money left over
- Trade-offs: one or two lines on what you gave up and what to change for a better flight or more savings`;

function parseArgs() {
  const [budgetArg, ...noteParts] = process.argv.slice(2);
  const budget = Number(budgetArg);
  const notes = noteParts.join(" ").trim();
  if (!Number.isFinite(budget) || budget <= 0 || !notes) {
    console.error('Usage: npm run plan -- <budget> "<notes>"');
    console.error('  e.g. npm run plan -- 1500 "HNL to Seattle Nov 14-20, want to walk everywhere"');
    process.exit(1);
  }
  return { budget, notes };
}

function summarize(text: string, isError: boolean): string {
  if (isError) return `error: ${text}`;
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.results)) {
      const prices = data.results.map((r: { price: number }) => r.price);
      return `${data.count} found, $${Math.min(...prices)}-$${Math.max(...prices)}`;
    }
    if ("withinBudget" in data) {
      return data.withinBudget ? `fits: total $${data.total}` : `over budget by $${data.overage} (total $${data.total})`;
    }
  } catch {
  }
  return text.slice(0, 120);
}

async function main() {
  const { budget, notes } = parseArgs();
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
    new StdioClientTransport({ command: "npx", args: ["tsx", path.join(root, "mcp-server/server.ts")] }),
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
      { role: "system", content: SYSTEM_PROMPT },
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
