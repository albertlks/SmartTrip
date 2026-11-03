import type { Idea } from "@/agent/ideas";

const MIN_CARDS = 4;
const MAX_CARDS = 6;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 4 to 6 ideas in season this month, topped up from next month when this month has too few. */
export function pickIdeas(ideas: Idea[], month: number): Idea[] {
  const next = (month % 12) + 1;
  const now = ideas.filter((i) => i.months.includes(month));
  const later = ideas.filter((i) => !now.includes(i) && i.months.includes(next));
  return [...now, ...later.slice(0, Math.max(0, MIN_CARDS - now.length))].slice(0, MAX_CARDS);
}

/** Where the cursor goes after filling: the "your city" blank, so typing replaces it. */
export type Filled = { text: string; select?: [number, number] };

export const ORIGIN_BLANK = "your city";

/** The card's sentence with {origin} replaced by the home airport, or by a selected blank. */
export function fillPrompt(prompt: string, homeAirport: string | null): Filled {
  const origin = homeAirport?.trim() || ORIGIN_BLANK;
  const at = prompt.indexOf("{origin}");
  const text = prompt.replace("{origin}", origin);
  return at >= 0 && !homeAirport?.trim() ? { text, select: [at, at + origin.length] } : { text };
}

/** [12, 1, 2, 3, 4] -> "Dec–Apr"; [3, 4, 10, 11] -> "Mar–Apr, Oct–Nov"; all 12 -> "Year-round". */
export function seasonLabel(months: number[]): string {
  if (months.length >= 12) return "Year-round";
  const runs: number[][] = [];
  for (const m of months) {
    const run = runs[runs.length - 1];
    if (run && (run[run.length - 1] % 12) + 1 === m) run.push(m);
    else runs.push([m]);
  }
  return runs
    .map((r) => (r.length === 1 ? MONTHS[r[0] - 1] : `${MONTHS[r[0] - 1]}–${MONTHS[r[r.length - 1] - 1]}`))
    .join(", ");
}
