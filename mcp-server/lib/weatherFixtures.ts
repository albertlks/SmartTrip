import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, loadAirports } from "./data";

/**
 * Answers Open-Meteo requests from data/fixtures/open-meteo-<forecast|archive>-<CODE>-<start>-<end>.json, so tests and
 * seed runs make no network calls. The airport is found from the request's coordinates (weather.ts sends the airport's
 * own). Anything without a saved file answers like an Open-Meteo error.
 */
export const fixtureWeatherFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const kind = url.hostname.startsWith("archive") ? "archive" : "forecast";
  const lat = Number(url.searchParams.get("latitude"));
  const lon = Number(url.searchParams.get("longitude"));
  const code = (await loadAirports()).find((a) => a.latitude === lat && a.longitude === lon)?.code ?? "unknown";
  const name = `open-meteo-${kind}-${code}-${url.searchParams.get("start_date")}-${url.searchParams.get("end_date")}.json`;
  const text = await readFile(path.join(DATA_DIR, "fixtures", name), "utf8").catch(() => null);
  return text
    ? new Response(text, { headers: { "Content-Type": "application/json" } })
    : Response.json({ error: true, reason: `no saved weather fixture ${name}` }, { status: 400 });
};
