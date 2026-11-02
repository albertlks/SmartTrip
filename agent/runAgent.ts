import OpenAI from "openai";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../mcp-server/createServer";
import { newRunContext } from "../mcp-server/lib/runContext";
import { createLlm, llmProvider } from "./llm";
import { systemPrompt } from "./systemPrompt";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const TRIP_TOOLS = new Set(["lookupAirport", "searchFlights", "searchHotels", "estimateTransport", "checkBudget"]);
// Each step re-sends the whole conversation, so cap it to protect the budget.
const DEFAULT_MAX_STEPS = 12;

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
  | { type: "tool_call"; step: number; name: string; args: string }
  | { type: "tool_result"; entry: TraceEntry };

export type AgentResult = {
  /** The structured request; set once the agent records it (free-text issue). */
  request: null;
  /** The presented trips; set once presentTrips exists. */
  trips: null;
  /** The model's final text, or null if it stopped early. */
  answer: string | null;
  trace: TraceEntry[];
  /** The conversation without the system prompt, to pass back in for a follow-up. */
  messages: Message[];
  /** True when the step cap was hit before a final answer. */
  stoppedEarly: boolean;
};

function maxSteps(): number {
  const n = Number(process.env.AGENT_MAX_STEPS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_STEPS;
}

/**
 * Runs the planner on a conversation (user and earlier assistant/tool messages, no system prompt).
 * Tools run in-process over MCP. Throws on LLM failures; describeLlmError turns them into readable text.
 */
export async function runAgent(messages: Message[], onEvent?: (event: AgentEvent) => void): Promise<AgentResult> {
  const provider = llmProvider();
  const llm = createLlm(provider);
  const conversation: Message[] = [{ role: "system", content: systemPrompt() }, ...messages];
  const trace: TraceEntry[] = [];
  const result = (answer: string | null, stoppedEarly: boolean): AgentResult => ({
    request: null,
    trips: null,
    answer,
    trace,
    messages: conversation.slice(1),
    stoppedEarly,
  });

  const server = createServer(newRunContext());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "smarttrip-agent", version: "0.2.0" });
  await mcp.connect(clientTransport);

  try {
    const { tools } = await mcp.listTools();
    const llmTools: OpenAI.Chat.ChatCompletionTool[] = tools
      .filter((t) => TRIP_TOOLS.has(t.name))
      .map((t) => {
        const { $schema: _, ...parameters } = t.inputSchema as Record<string, unknown>;
        return { type: "function", function: { name: t.name, description: t.description, parameters } };
      });

    const limit = maxSteps();
    for (let step = 1; step <= limit; step++) {
      onEvent?.({ type: "llm_request", step, model: provider.model, provider: provider.name });
      const response = await llm.chat.completions.create({ model: provider.model, messages: conversation, tools: llmTools });
      const message = response.choices[0].message;
      conversation.push(message);

      if (!message.tool_calls?.length) return result(message.content ?? "", false);

      for (const call of message.tool_calls) {
        if (call.type !== "function") continue;
        const { name, arguments: args } = call.function;
        onEvent?.({ type: "tool_call", step, name, args });
        const started = Date.now();
        let text: string;
        let isError: boolean;
        try {
          const res = await mcp.callTool({ name, arguments: JSON.parse(args) });
          text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
          isError = res.isError === true;
        } catch (err) {
          // Bad JSON from the model: send the error back so it can retry.
          text = `Could not call ${name}: ${err instanceof Error ? err.message : String(err)}`;
          isError = true;
        }
        const entry: TraceEntry = { step, name, args, isError, result: text, ms: Date.now() - started };
        trace.push(entry);
        onEvent?.({ type: "tool_result", entry });
        conversation.push({ role: "tool", tool_call_id: call.id, content: text });
      }
    }
    return result(null, true);
  } finally {
    await mcp.close();
    await server.close();
  }
}
