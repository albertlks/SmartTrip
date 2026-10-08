import path from "node:path";
import { config } from "dotenv";
import OpenAI from "openai";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { registerCheckBudget } from "./tools/checkBudget";
import { registerSearchFlights } from "./tools/searchFlights";

const root = path.resolve(import.meta.dirname, "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

const BASE_URL = process.env.LLM_BASE_URL ?? "https://128.171.10.80:9443/v1";
const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL ?? "gpt-4.1-nano";

const client = process.env.LLM_API_KEY
  ? new OpenAI({ baseURL: BASE_URL, apiKey: process.env.LLM_API_KEY })
  : null;

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
      if (!client) return errorResult(new Error("LLM_API_KEY is not set. Add it to .env.local (never commit it)."));
      try {
        const ids: string[] = [];
        for await (const model of client.models.list()) ids.push(model.id);
        return { content: [{ type: "text", text: ids.join("\n") }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  registerCheckBudget(server);
  registerSearchFlights(server);
  return server;
}

serveStdio(createServer, { onerror: (err) => console.error(err) });
