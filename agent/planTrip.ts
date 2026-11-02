// Usage: npm run plan -- <budget> "<notes>"
import path from "node:path";
import { config } from "dotenv";
import { describeLlmError, llmProvider } from "./llm";
import { runAgent, type AgentEvent } from "./runAgent";

const root = path.resolve(import.meta.dirname, "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

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

function printEvent(event: AgentEvent) {
  if (event.type === "llm_request") {
    console.error(`\nstep ${event.step}: asking ${event.model} via ${event.provider}...`);
  } else if (event.type === "tool_result") {
    const { name, args, isError, result } = event.entry;
    console.error(`  ${isError ? "x" : "-"} ${name} ${args}`);
    console.error(`      ${summarize(result, isError)}`);
  }
}

async function main() {
  const { budget, notes } = parseArgs();
  try {
    const result = await runAgent([{ role: "user", content: `Budget: $${budget}\nNotes: ${notes}` }], printEvent);
    if (result.stoppedEarly) {
      console.error(
        `\nSearch stopped early at the step limit (AGENT_MAX_STEPS) after ${result.trace.length} tool call(s), ` +
          "without a final plan. Try clearer notes or a bigger budget.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\n${result.answer || "(no answer)"}`);
  } catch (err) {
    const message = describeLlmError(err, llmProvider());
    if (!message) throw err;
    console.error(message);
    process.exitCode = 1;
  }
}

main();
