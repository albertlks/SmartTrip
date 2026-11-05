// Usage: npm run plan -- "<your trip request>"
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { describeLlmError, llmProvider } from "./llm";
import { runAgent, type AgentEvent } from "./runAgent";

const root = path.resolve(import.meta.dirname, "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

// How many clarifying questions the CLI answers before giving up.
const MAX_QUESTIONS = 3;

function parseArgs(): string {
  const message = process.argv.slice(2).join(" ").trim();
  if (!message) {
    console.error('Usage: npm run plan -- "<your trip request>"');
    console.error('  e.g. npm run plan -- "2 of us, Honolulu to Seattle Dec 11-15, $1,600, want to walk everywhere"');
    process.exit(1);
  }
  return message;
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
    if ("recorded" in data) {
      return data.missing.length ? `recorded, missing: ${data.missing.join(", ")}` : "recorded";
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
  const firstMessage = parseArgs();
  // Interactive only when a person can type the answer to a question.
  const prompt = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stderr }) : null;
  try {
    let result = await runAgent([{ role: "user", content: firstMessage }], printEvent);
    for (let asked = 0; result.status === "needs_input" && prompt && asked < MAX_QUESTIONS; asked++) {
      const answer = (await prompt.question(`\n${result.answer}\n> `)).trim();
      if (!answer) break;
      result = await runAgent([...result.messages, { role: "user", content: answer }], printEvent);
    }

    if (result.status === "stopped_early") {
      console.error(
        `\nSearch stopped early at the step limit (AGENT_MAX_STEPS) after ${result.trace.length} tool call(s), ` +
          "without a final plan. Try a clearer request or a bigger budget.",
      );
      process.exitCode = 1;
    } else if (result.status === "needs_input") {
      console.log(`\nSmartTrip needs one more detail: ${result.answer}`);
      process.exitCode = 2;
    } else {
      console.log(`\n${result.answer || "(no answer)"}`);
    }
  } catch (err) {
    const message = describeLlmError(err, llmProvider());
    if (!message) throw err;
    console.error(message);
    process.exitCode = 1;
  } finally {
    prompt?.close();
  }
}

main();
