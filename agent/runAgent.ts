import OpenAI from "openai";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../mcp-server/createServer";
import { loadAirports } from "../mcp-server/lib/data";
import { newRunContext } from "../mcp-server/lib/runContext";
import type { Trip } from "../mcp-server/lib/trips";
import { lookupAirport } from "../mcp-server/tools/lookupAirport";
import { createLlm, llmProvider } from "./llm";
import { recordRequest, recordRequestTool, type TripRequest } from "./recordRequest";
import { localToday, systemPrompt } from "./systemPrompt";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const TRIP_TOOLS = new Set(["lookupAirport", "searchFlights", "searchHotels", "estimateTransport", "checkBudget", "presentTrips"]);
// Each step re-sends the whole conversation, so cap it to protect the budget.
const DEFAULT_MAX_STEPS = 20;
const RECORD_NUDGE =
  "(SmartTrip) Before answering, call recordRequest with what you understood from my message. " +
  "If something essential is missing, put your one question in its question field.";
const PRESENT_NUDGE =
  "(SmartTrip) Before answering, call presentTrips with the packages you recommend, so the totals come from the server. " +
  "Don't add up totals yourself.";

/** Resolves a place the user named ("Seattle", "SEA") to its main airport code, the way lookupAirport does. */
async function airportOf(): Promise<(place: string) => string | undefined> {
  const airports = await loadAirports();
  return (place) => lookupAirport(airports, place)[0]?.code;
}

export type TraceEntry = {
  step: number;
  name: string;
  /** The arguments as the model sent them (JSON text, possibly invalid). */
  args: string;
  isError: boolean;
  /** The tool's text result, or why the call could not be made. */
  result: string;
  ms: number;
};

export type AgentEvent =
  | { type: "llm_request"; step: number; model: string; provider: string }
  | { type: "llm_response"; step: number; promptTokens: number; completionTokens: number }
  | { type: "tool_call"; step: number; name: string; args: string }
  | { type: "tool_result"; entry: TraceEntry };

export type AgentStatus = "done" | "needs_input" | "stopped_early";

export type AgentResult = {
  /** done: final answer; needs_input: answer is the one question for the user; stopped_early: step cap hit. */
  status: AgentStatus;
  /** What the agent understood, from its last recordRequest call in this run. */
  request: TripRequest | null;
  /** The trips from the last successful presentTrips call, ranked; null if none were presented. */
  trips: Trip[] | null;
  /** The final text or the question, or null if the run stopped early. */
  answer: string | null;
  trace: TraceEntry[];
  /** LLM calls and tokens this run used (tokens are 0 when the provider doesn't report them). */
  usage: { llmCalls: number; promptTokens: number; completionTokens: number };
  /** The conversation without the system prompt, to pass back in with the user's next message. */
  messages: Message[];
};

function maxSteps(): number {
  const n = Number(process.env.AGENT_MAX_STEPS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_STEPS;
}

/** Lets tests swap in a scripted LLM so they make no API calls, and fix "today" so saved fixtures' dates still count as future. */
export type AgentDeps = { llm?: Pick<OpenAI, "chat">; today?: string };

/**
 * Runs the planner on a conversation (user and earlier assistant/tool messages, no system prompt).
 * Tools run in-process over MCP. Throws on LLM failures; describeLlmError turns them into readable text.
 */
export async function runAgent(
  messages: Message[],
  onEvent?: (event: AgentEvent) => void,
  deps: AgentDeps = {},
): Promise<AgentResult> {
  const provider = llmProvider();
  const llm = deps.llm ?? createLlm(provider);
  const today = deps.today ?? localToday();
  const conversation: Message[] = [{ role: "system", content: systemPrompt(today) }, ...messages];
  const trace: TraceEntry[] = [];
  let request: TripRequest | null = null;
  // Each reminder is sent at most once per run.
  let recordNudged = false;
  let presentNudged = false;
  const usage = { llmCalls: 0, promptTokens: 0, completionTokens: 0 };
  const ctx = newRunContext();
  const result = (status: AgentStatus, answer: string | null): AgentResult => ({
    status,
    request,
    trips: ctx.trips ?? null,
    answer,
    trace,
    usage,
    messages: conversation.slice(1),
  });

  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "smarttrip-agent", version: "0.2.0" });
  await mcp.connect(clientTransport);

  /** Runs one tool call and returns its text result. recordRequest is handled here; the rest go to MCP. */
  async function callTool(
    name: string,
    args: string,
    question: string | null,
  ): Promise<{ text: string; isError: boolean; asked?: string | null }> {
    if (name === "recordRequest") {
      const recorded = recordRequest(args, today, await airportOf());
      if ("error" in recorded) return { text: recorded.error, isError: true };
      request = recorded.request;
      const { travelers, budget, departDate, returnDate } = recorded.request;
      ctx.request = { travelers, budget, departDate, returnDate };
      const text = JSON.stringify({ recorded: true, missing: recorded.request.missing });
      return { text, isError: false, asked: recorded.request.question };
    }
    if (!request) {
      return { text: `Not run: call recordRequest first with what you understood from the user's message.`, isError: true };
    }
    if (question) {
      return { text: "Not run: waiting for the user's answer to your question.", isError: true };
    }
    try {
      const res = await mcp.callTool({ name, arguments: JSON.parse(args) });
      return { text: res.content.map((c) => (c.type === "text" ? c.text : "")).join(""), isError: res.isError === true };
    } catch (err) {
      // Bad JSON from the model: send the error back so it can retry.
      return { text: `Could not call ${name}: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  try {
    const { tools } = await mcp.listTools();
    const llmTools: OpenAI.Chat.ChatCompletionTool[] = [
      recordRequestTool,
      ...tools
        .filter((t) => TRIP_TOOLS.has(t.name))
        .map((t): OpenAI.Chat.ChatCompletionTool => {
          const { $schema: _, ...parameters } = t.inputSchema as Record<string, unknown>;
          return { type: "function", function: { name: t.name, description: t.description, parameters } };
        }),
    ];

    const limit = maxSteps();
    for (let step = 1; step <= limit; step++) {
      onEvent?.({ type: "llm_request", step, model: provider.model, provider: provider.name });
      const response = await llm.chat.completions.create({ model: provider.model, messages: conversation, tools: llmTools });
      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
      usage.llmCalls++;
      usage.promptTokens += promptTokens;
      usage.completionTokens += completionTokens;
      onEvent?.({ type: "llm_response", step, promptTokens, completionTokens });
      const message = response.choices[0].message;
      conversation.push(message);

      if (!message.tool_calls?.length) {
        // Never read meaning out of prose: ask once for the structured request instead.
        if (!request && !recordNudged) {
          recordNudged = true;
          conversation.push({ role: "user", content: RECORD_NUDGE });
          continue;
        }
        // Totals must come from presentTrips, not the model's own arithmetic.
        if (request && !ctx.trips && !presentNudged) {
          presentNudged = true;
          conversation.push({ role: "user", content: PRESENT_NUDGE });
          continue;
        }
        return result("done", message.content ?? "");
      }

      // recordRequest goes first so a question in it stops the other calls in the same turn.
      const calls = message.tool_calls
        .filter((c) => c.type === "function")
        .sort((a, b) => Number(b.function.name === "recordRequest") - Number(a.function.name === "recordRequest"));
      let question: string | null = null;
      for (const call of calls) {
        const { name, arguments: args } = call.function;
        onEvent?.({ type: "tool_call", step, name, args });
        const started = Date.now();
        const { text, isError, asked } = await callTool(name, args, question);
        if (asked !== undefined) question = asked;
        const entry: TraceEntry = { step, name, args, isError, result: text, ms: Date.now() - started };
        trace.push(entry);
        onEvent?.({ type: "tool_result", entry });
        conversation.push({ role: "tool", tool_call_id: call.id, content: text });
      }

      if (question) {
        // Ending on an assistant message keeps the conversation valid when the user's answer is appended.
        conversation.push({ role: "assistant", content: question });
        return result("needs_input", question);
      }
    }
    return result("stopped_early", null);
  } finally {
    await mcp.close();
    await server.close();
  }
}
