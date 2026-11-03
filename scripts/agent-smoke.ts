// Runs free-text requests through the real LLM (mock travel data) and prints what the agent did.
// Uses LLM calls, so it is not part of npm run check. Usage: npx tsx scripts/agent-smoke.ts [case number]
import path from "node:path";
import { config } from "dotenv";
import { describeLlmError, llmProvider } from "../agent/llm";
import { runAgent, type AgentResult } from "../agent/runAgent";

const root = path.resolve(import.meta.dirname, "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

type Case = { label: string; message: string; answer?: string };

const CASES: Case[] = [
  { label: "no budget: asks one question, then plans", message: "Honolulu to Seattle Dec 11-15, 2 of us", answer: "$1,600 total" },
  { label: "no origin: asks where from", message: "Seattle, Dec 11-15, $1,600, just me", answer: "Honolulu" },
  { label: "complete: plans straight away", message: "2 of us, Honolulu to Seattle Dec 11-15, $1,600" },
  { label: "vague destination: picks from ideas", message: "Somewhere warm in January from Honolulu, 2 people, 5 nights mid-January, $2,500" },
  { label: "relative dates and a preference", message: "me and my partner want to fly out of HNL to Vegas the weekend after next, nonstop please, budget 1200" },
];

function describe(result: AgentResult): string {
  const tools = result.trace.map((t) => `${t.isError ? "x" : ""}${t.name}`).join(", ") || "(none)";
  const r = result.request;
  const request = r
    ? `origin=${r.origin} destinations=[${r.destinations.join(", ")}]${r.destinationsFromIdeas ? " (from ideas)" : ""} ` +
      `dates=${r.departDate}..${r.returnDate} travelers=${r.travelers}${r.travelersDefaulted ? " (default)" : ""} ` +
      `budget=${r.budget} prefs=[${r.preferences.join(", ")}] missing=[${r.missing.join(", ")}]`
    : "(none recorded)";
  const errors = result.trace.filter((t) => t.isError).map((t) => `${t.name}: ${t.result.slice(0, 160)}`);
  const trips = (result.trips ?? [])
    .map((t) => `${t.tripId} ${t.destination} ${t.flight.id}+${t.hotel.id} $${t.totals.total} ${t.withinBudget ? "fits" : "over"}`)
    .join(" | ");
  const answer = (result.answer ?? "").split("\n").filter(Boolean).slice(0, 6).join("\n    ");
  return (
    `  status: ${result.status}\n  request: ${request}\n  tools: ${tools} (${result.trace.length} calls)\n` +
    `  llm: ${result.usage.llmCalls} calls, ${result.usage.promptTokens} input + ${result.usage.completionTokens} output tokens\n` +
    (errors.length ? `  errors:\n    ${errors.join("\n    ")}\n` : "") +
    `  trips: ${trips || "(none)"}\n` +
    `  answer:\n    ${answer}`
  );
}

async function main() {
  const only = Number(process.argv[2]);
  const cases = Number.isInteger(only) && only > 0 ? [CASES[only - 1]] : CASES;
  for (const [i, c] of cases.entries()) {
    console.log(`\n=== ${only || i + 1}. ${c.label} [${llmProvider().model}]\n> ${c.message}`);
    try {
      let result = await runAgent([{ role: "user", content: c.message }]);
      console.log(describe(result));
      if (result.status === "needs_input" && c.answer) {
        console.log(`> ${c.answer}`);
        result = await runAgent([...result.messages, { role: "user", content: c.answer }]);
        console.log(describe(result));
      }
    } catch (err) {
      console.log(`  error: ${describeLlmError(err, llmProvider()) ?? err}`);
    }
  }
}

main();
