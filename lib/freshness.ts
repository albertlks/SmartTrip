import type { Source } from "@/mcp-server/lib/providers";
import type { WeatherResult } from "@/mcp-server/lib/weather";

// Where each piece of data came from, and how old it is. A cache hit is never called "Live".

export type FreshnessTone = "success" | "neutral" | "accent";
export type Freshness = { label: string; tone: FreshnessTone; title: string };

/** Data fetched within this window still counts as live. */
const LIVE_MS = 10 * 60 * 1000;

/** 0 -> "just now", 12 min -> "12m ago", 3 h -> "3h ago", 2 days -> "2d ago". */
export function ago(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/** The badge for flights, hotels, or return flights. fetchedAt is when SerpApi answered (ms), cache whether this run reused it. */
export function freshness(source: Source, cache: "hit" | "miss" | undefined, fetchedAt: number | undefined, now: number): Freshness {
  if (source === "mock") return { label: "Sample data", tone: "neutral", title: "Made-up sample data, not real prices." };
  if (source === "fixture") {
    return { label: "Saved search", tone: "neutral", title: "A real Google search saved earlier, not today's prices." };
  }
  if (fetchedAt === undefined) return { label: "Google via SerpApi", tone: "accent", title: "Live search results." };
  const age = now - fetchedAt;
  const when = new Date(fetchedAt).toISOString();
  if (cache === "hit") return { label: `Cached ${ago(age)}`, tone: "accent", title: `Fetched from Google at ${when} and reused.` };
  return age < LIVE_MS
    ? { label: "Live", tone: "success", title: `Fetched from Google at ${when}.` }
    : { label: `Fetched ${ago(age)}`, tone: "accent", title: `Fetched from Google at ${when}.` };
}

/** The weather badge: always Open-Meteo, with whether it is a forecast. */
export function weatherFreshness(basis: WeatherResult["basis"]): Freshness {
  const kind = basis === "forecast" ? "forecast" : basis === "mixed" ? "forecast and last year" : "last year";
  return { label: `Open-Meteo · ${kind}`, tone: "neutral", title: "Weather from Open-Meteo." };
}

/** The source a search step reported in the agent trace ("fixture", "mock", "serpapi"), as a short badge; null when none. */
export function traceSource(result: string): Freshness | null {
  const match = /"source":"(mock|fixture|serpapi)"/.exec(result.slice(0, 200));
  if (!match) return null;
  const source = match[1] as Source;
  return source === "serpapi"
    ? { label: "Google via SerpApi", tone: "accent", title: "Live search, or the 24-hour cache." }
    : freshness(source, undefined, undefined, 0);
}
