import path from "node:path";
import { config } from "dotenv";
import OpenAI from "openai";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod";

// quiet: stdout is the MCP wire on stdio, so nothing else may print to it.
// Resolve .env files from the project root so the server works from any cwd.
const root = path.resolve(import.meta.dirname, "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

const BASE_URL = process.env.LLM_BASE_URL ?? "https://128.171.10.80:9443/v1";
// Cheap paid model ($0.10/$0.40 per 1M tokens); override with LLM_DEFAULT_MODEL.
const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL ?? "gpt-4.1-nano";

if (!process.env.LLM_API_KEY) {
  console.error("LLM_API_KEY is not set. Add it to .env.local (never commit it).");
  process.exit(1);
}

const client = new OpenAI({ baseURL: BASE_URL, apiKey: process.env.LLM_API_KEY });

function errorResult(err: unknown) {
  let text = err instanceof Error ? err.message : String(err);
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) text = "401: API key is missing, wrong, or was regenerated. Check LLM_API_KEY.";
    else if (err.status === 429) text = "429: course budget is used up. Retrying won't help — ask the instructor/TA.";
    else if (err.status === 400) text = `400: bad model ID or parameter (${err.message}). Call list_models for valid IDs.`;
  }
  return { content: [{ type: "text" as const, text }], isError: true };
}

function createServer() {
  const server = new McpServer({ name: "llm-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.registerTool(
    "list_models",
    {
      title: "List models",
      description: "List the model IDs this API key can call on the course LLM gateway.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const ids: string[] = [];
        for await (const model of client.models.list()) ids.push(model.id);
        return { content: [{ type: "text", text: ids.join("\n") }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "chat",
    {
      title: "Chat completion",
      description:
        `Send a prompt to a model on the course LLM gateway and return its reply. ` +
        `Defaults to "${DEFAULT_MODEL}". Every model except the free ones spends the course budget.`,
      inputSchema: z.object({
        prompt: z.string().describe("The user message to send."),
        system: z.string().optional().describe("Optional system prompt."),
        model: z.string().optional().describe(`Model ID (default: ${DEFAULT_MODEL}). See list_models.`),
        temperature: z.number().min(0).max(2).optional(),
        max_tokens: z.number().int().positive().optional(),
      }),
    },
    async ({ prompt, system, model, temperature, max_tokens }) => {
      try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (system) messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });

        const response = await client.chat.completions.create({
          model: model ?? DEFAULT_MODEL,
          messages,
          temperature,
          max_tokens,
        });
        return { content: [{ type: "text", text: response.choices[0]?.message.content ?? "" }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

serveStdio(createServer, { onerror: (err) => console.error(err) });
