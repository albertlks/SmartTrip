import { readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../mcp-server/lib/projectRoot";

export const IDEA_THEMES = ["warm", "winter", "food", "adventure", "city"] as const;

/** A popular destination from data/ideas.json: a landing-page card and a choice for vague requests. */
export type Idea = {
  title: string;
  tagline: string;
  destinationCity: string;
  airport: string;
  /** Months (1 to 12) when the idea is in season. */
  months: number[];
  theme: (typeof IDEA_THEMES)[number];
  /** City centre, for activity searches (the airport can be far from the centre). */
  cityLatitude: number;
  cityLongitude: number;
  /** The sentence a card types into the search box; {origin} is filled with the home airport or left blank. */
  prompt: string;
};

const IDEAS_FILE = path.join(projectRoot(), "data/ideas.json");

export function loadIdeas(): Idea[] {
  return JSON.parse(readFileSync(IDEAS_FILE, "utf8")) as Idea[];
}
