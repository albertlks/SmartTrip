import OpenAI from "openai";

export type LlmProvider = {
  name: string;
  baseURL: string;
  apiKey?: string;
  keyVar: string;
  model: string;
  headers: Record<string, string>;
};

/**
 * OpenRouter when OPENROUTER_API_KEY is set, otherwise the course gateway. The model comes from
 * OPENROUTER_MODEL or LLM_DEFAULT_MODEL. Read at call time, so callers can load .env files first.
 */
export function llmProvider(): LlmProvider {
  return process.env.OPENROUTER_API_KEY
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
}

/** A failure whose message is safe and actionable to show the user (CLI or web). */
export class AgentError extends Error {}

export function createLlm(provider: LlmProvider): OpenAI {
  if (!provider.apiKey) {
    throw new AgentError("No API key. Add OPENROUTER_API_KEY (or LLM_API_KEY for the course gateway) to .env.local.");
  }
  return new OpenAI({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    defaultHeaders: provider.headers,
    timeout: 60_000,
    maxRetries: 1,
  });
}

/** A readable message for a known LLM failure, or undefined for anything else. */
export function describeLlmError(err: unknown, provider: LlmProvider): string | undefined {
  if (err instanceof AgentError) return err.message;
  if (err instanceof OpenAI.APIConnectionError) {
    return `Can't reach ${provider.name} (${err.message}). Check your network/VPN, then retry.`;
  }
  if (!(err instanceof OpenAI.APIError)) return undefined;
  switch (err.status) {
    case 401:
      return `401: ${provider.keyVar} is wrong, expired, or was regenerated.`;
    case 402:
      return "402: out of OpenRouter credits. Add credits or pick a cheaper model with OPENROUTER_MODEL.";
    case 429:
      return provider.name === "OpenRouter"
        ? "429: OpenRouter rate limit. Wait a minute and retry."
        : "429: course budget is used up. Retrying won't help — ask the instructor/TA.";
    case 400:
      return `400: ${provider.name} rejected the request for "${provider.model}": ${err.message.split("\n")[0]}`;
    case 404:
      return `404: model "${provider.model}" not found on ${provider.name}. Check the model ID.`;
    default:
      return undefined;
  }
}
