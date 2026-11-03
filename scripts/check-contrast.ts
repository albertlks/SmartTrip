// Checks WCAG contrast for every text-on-background pair the components use, in both themes.
// Reads the token values from app/globals.css. Run with: npx tsx scripts/check-contrast.ts
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");

/** WCAG 2.1: 4.5 for body text, 3 for large text and UI parts such as focus rings and borders of controls. */
const TEXT = 4.5;
const UI = 3;

// [foreground, background, minimum ratio, where it's used]
const PAIRS: [string, string, number, string][] = [
  ["ink", "canvas", TEXT, "body text"],
  ["ink", "surface", TEXT, "text on cards"],
  ["ink", "raised", TEXT, "text on raised panels"],
  ["muted", "canvas", TEXT, "secondary text"],
  ["muted", "surface", TEXT, "secondary text on cards"],
  ["muted", "raised", TEXT, "secondary text on raised panels"],
  ["accent", "canvas", TEXT, "links"],
  ["accent", "surface", TEXT, "links on cards"],
  ["on-accent", "accent", TEXT, "primary button label"],
  ["accent-strong", "accent-soft", TEXT, "chips and accent badges"],
  ["success", "success-soft", TEXT, "under-budget badge"],
  ["warning", "warning-soft", TEXT, "warning badge"],
  ["danger", "danger-soft", TEXT, "error badge"],
  ["success", "surface", TEXT, "under-budget text"],
  ["warning", "surface", TEXT, "warning text"],
  ["danger", "surface", TEXT, "error text"],
  ["ink", "danger-soft", TEXT, "error message body"],
  ["accent", "canvas", UI, "focus ring"],
  ["accent", "raised", UI, "focus ring on raised panels"],
];

function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No "${selector}" block in app/globals.css`);
  const block = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let failures = 0;
for (const [theme, selector] of [["light", ":root"], ["dark", ':root[data-theme="dark"]']]) {
  const t = tokens(selector);
  for (const [fg, bg, min, use] of PAIRS) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${theme}: ${fg} on ${bg} ${r.toFixed(2)}:1 (needs ${min}, ${use})`);
  }
}

// The dark values are written twice (data-theme and the system media query); they must match.
const media = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark)"));
const mediaTokens = Object.fromEntries([...media.slice(0, media.indexOf("}")).matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
const darkTokens = tokens(':root[data-theme="dark"]');
const drift = Object.keys(darkTokens).filter((k) => mediaTokens[k] !== darkTokens[k]);
if (drift.length) failures++;
console.log(`${drift.length ? "FAIL" : "PASS"}  system-dark tokens match data-theme="dark"${drift.length ? `: ${drift.join(", ")}` : ""}`);

console.log(failures ? `\n${failures} contrast check(s) failed` : "\nAll contrast checks passed");
process.exit(failures ? 1 : 0);
