// Builds data/airports.json from OurAirports (public domain, https://ourairports.com/data/).
// Usage: download the CSVs into data/raw/ (gitignored), then run npx tsx scripts/build-airports.ts
//   curl -sSfL -o data/raw/airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   curl -sSfL -o data/raw/regions.csv https://davidmegginson.github.io/ourairports-data/regions.csv
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const RAW_DIR = path.join(root, "data/raw");
const OUT_FILE = path.join(root, "data/airports.json");

const TYPES = ["large_airport", "medium_airport", "small_airport"] as const;
type AirportType = (typeof TYPES)[number];

/** Parses RFC 4180 CSV (quoted fields, "" escapes, commas and newlines inside quotes) into header-keyed rows. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length) rows.push([...row, field]);

  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const readCsv = (file: string) => parseCsv(readFileSync(path.join(RAW_DIR, file), "utf8"));

// Names people type that OurAirports' city and keywords don't cover. Keep this short and add only real gaps.
const ALIASES: Record<string, string[]> = {
  OGG: ["Maui"],
  KOA: ["Big Island", "Kona"],
  ITO: ["Big Island"],
};

/** About 11 m of precision: plenty for distances and map pins, and keeps the file small. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function main() {
  const regionNames = new Map(readCsv("regions.csv").map((r) => [r.code, r.name]));

  const byCode = new Map<string, ReturnType<typeof toAirport>>();
  function toAirport(r: Record<string, string>) {
    const code = r.iata_code.trim().toUpperCase();
    const city = r.municipality.trim();
    const name = r.name.trim();
    // Keywords hold aliases like "NYC" or "Maui"; drop ones that repeat the code, city, or name.
    const known = new Set([code, city, name].map((s) => s.toLowerCase()));
    const keywords = [
      ...new Set(
        [...r.keywords.split(","), ...(ALIASES[code] ?? [])]
          .map((k) => k.trim())
          .filter((k) => k.length >= 2 && !known.has(k.toLowerCase())),
      ),
    ];
    return {
      code,
      name,
      city,
      region: regionNames.get(r.iso_region) ?? r.iso_region,
      country: r.iso_country,
      type: r.type.replace("_airport", "") as "large" | "medium" | "small",
      latitude: round4(Number(r.latitude_deg)),
      longitude: round4(Number(r.longitude_deg)),
      ...(keywords.length ? { keywords } : {}),
    };
  }

  const rows = readCsv("airports.csv").filter(
    (r) =>
      /^[A-Za-z]{3}$/.test(r.iata_code.trim()) &&
      r.scheduled_service === "yes" &&
      TYPES.includes(r.type as AirportType) &&
      r.municipality.trim() !== "" &&
      Number.isFinite(Number(r.latitude_deg)) &&
      Number.isFinite(Number(r.longitude_deg)),
  );
  // A few IATA codes appear twice; keep the larger airport.
  for (const r of rows) {
    const airport = toAirport(r);
    const existing = byCode.get(airport.code);
    if (!existing || TYPES.indexOf(r.type as AirportType) < TYPES.indexOf(`${existing.type}_airport` as AirportType)) {
      byCode.set(airport.code, airport);
    }
  }

  const airports = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  // One airport per line keeps diffs readable.
  const json = `[\n${airports.map((a) => `  ${JSON.stringify(a)}`).join(",\n")}\n]\n`;
  writeFileSync(OUT_FILE, json);

  const counts = TYPES.map((t) => `${airports.filter((a) => `${a.type}_airport` === t).length} ${t.replace("_airport", "")}`);
  console.error(
    `Wrote ${airports.length} airports (${counts.join(", ")}) to ${path.relative(root, OUT_FILE)}, ` +
      `${(Buffer.byteLength(json) / 1024).toFixed(0)} KB.`,
  );
}

main();
