import type OpenAI from "openai";
import * as z from "zod";
import { isIsoDate } from "../mcp-server/lib/results";

// recordRequest is handled by runAgent itself, not the MCP server: it records what the agent understood
// from the user's message (the UI shows it as editable chips) and is how the agent asks its one question.

export const recordRequestInput = z.object({
  origin: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe('Where the trip starts, as the user said it (e.g. "Honolulu" or "HNL"). null if not given.'),
  destinations: z
    .array(z.string().trim().min(1))
    .max(3)
    .describe("Up to 3 destinations as city names or airport codes. Empty if the user named none and you chose none."),
  destinationsFromIdeas: z
    .boolean()
    .describe("true when the user named no destination and you chose these from the popular destinations list."),
  departDate: z.string().nullable().describe("Outbound date, YYYY-MM-DD. null if not given or ambiguous."),
  returnDate: z.string().nullable().describe("Return date, YYYY-MM-DD. null if not given or ambiguous."),
  travelers: z.number().int().min(1).describe("Number of people traveling. 1 if the user didn't say."),
  travelersDefaulted: z.boolean().describe("true when the user didn't say how many people and travelers is the default 1."),
  budget: z.number().positive().nullable().describe("Total budget in USD for all travelers. null if not given."),
  preferences: z
    .array(z.string().trim().min(1))
    .describe('Short phrases for the user\'s preferences, e.g. "nonstop", "walkable to downtown". Empty if none.'),
  question: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      "ONE short question for the user when origin, destination, dates, or budget is missing or ambiguous. " +
        "null when you have everything. When set, call no other tool: the user answers first.",
    ),
});

export type RequestField = "origin" | "destination" | "dates" | "budget";
export type TripRequest = z.output<typeof recordRequestInput> & { missing: RequestField[] };

/** The essential details still missing, worked out from the fields rather than trusting the model. */
export function missingFields(r: z.output<typeof recordRequestInput>): RequestField[] {
  const missing: RequestField[] = [];
  if (!r.origin) missing.push("origin");
  if (r.destinations.length === 0) missing.push("destination");
  if (!r.departDate || !r.returnDate) missing.push("dates");
  if (r.budget === null) missing.push("budget");
  return missing;
}

/** Validates the model's arguments. Returns the request, or an error message to send back so it can retry. */
export function recordRequest(rawArgs: string, today: string): { request: TripRequest } | { error: string } {
  let args: unknown;
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return { error: "recordRequest arguments were not valid JSON. Call it again." };
  }
  const parsed = recordRequestInput.safeParse(args);
  if (!parsed.success) {
    return { error: `recordRequest: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  const r = parsed.data;

  for (const [field, date] of [["departDate", r.departDate], ["returnDate", r.returnDate]] as const) {
    if (date !== null && !isIsoDate(date)) return { error: `${field} must be a real date in YYYY-MM-DD form, or null.` };
  }
  // ISO dates compare correctly as strings.
  if (r.departDate && r.departDate < today) {
    return { error: `departDate ${r.departDate} is in the past (today is ${today}). Use the next time that date comes around.` };
  }
  if (r.departDate && r.returnDate && r.returnDate <= r.departDate) {
    return { error: `returnDate (${r.returnDate}) must be after departDate (${r.departDate}).` };
  }

  const missing = missingFields(r);
  if (missing.length > 0 && !r.question) {
    return {
      error: `Missing: ${missing.join(", ")}. Set question to ONE short question asking for it, and call no other tool.`,
    };
  }
  return { request: { ...r, missing } };
}

const { $schema: _, ...parameters } = z.toJSONSchema(recordRequestInput) as Record<string, unknown>;

export const recordRequestTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "recordRequest",
    description:
      "Record what you understood from the user's message. Call it FIRST in every turn, before any other tool, " +
      "with the full request so far. If origin, destination, dates, or budget is missing or ambiguous, set question " +
      "to ONE short question and call no other tool. Returns { recorded: true, missing } or an error saying what to fix.",
    parameters,
  },
};
