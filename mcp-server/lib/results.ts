import type { CallToolResult } from "@modelcontextprotocol/server";

export const roundMoney = (n: number) => Math.round(n * 100) / 100;

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "2026-12-11" + 1 -> "2026-12-12" (calendar days, no time zone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A failure whose message is safe and actionable to show the agent as a toolError. */
export class ToolFailure extends Error {}
