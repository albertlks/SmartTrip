import type OpenAI from "openai";

// A scripted stand-in for the LLM, so tests drive the agent loop without API calls.

export type FakeCall = { name: string; args: object };
export type FakeTurn = { text?: string; calls?: FakeCall[] };

/** Answers each request with the next scripted turn, repeating the last one when the script runs out. */
export function fakeLlm(turns: FakeTurn[]): Pick<OpenAI, "chat"> {
  let i = 0;
  const create = async () => {
    const turn = turns[Math.min(i++, turns.length - 1)];
    const tool_calls = turn.calls?.map((c, n) => ({
      id: `call_${i}_${n}`,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
    return { choices: [{ message: { role: "assistant", content: turn.text ?? null, ...(tool_calls ? { tool_calls } : {}) } }] };
  };
  return { chat: { completions: { create } } } as unknown as Pick<OpenAI, "chat">;
}
