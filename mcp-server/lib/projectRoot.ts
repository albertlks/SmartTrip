import { existsSync } from "node:fs";
import path from "node:path";

// Under tsx, import.meta.dirname is this source folder. Inside a Next.js server bundle it can point into .next/,
// so fall back to the folder the server was started from (the project root for npm run dev and npm start).
const fromSource = import.meta.dirname ? path.resolve(import.meta.dirname, "../..") : "";

/** The SmartTrip project folder, where data/ lives. */
export function projectRoot(): string {
  return fromSource && existsSync(path.join(fromSource, "data/ideas.json")) ? fromSource : process.cwd();
}
