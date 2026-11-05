import { getAirport } from "./data";
import { fixtureWeatherFetch } from "./weatherFixtures";
import { addDays, daysBetween, ToolFailure } from "./results";

// Weather for a stay from Open-Meteo (free, no key). Days up to today + 15 use the forecast; later days can't be
// forecast, so they use last year's actual weather for the same dates, labelled as such. Nothing is guessed.

export const LAST_YEAR = "last year's actuals for the same dates";

export type WeatherDay = {
  date: string;
  basis: "forecast" | "last year";
  highF: number;
  lowF: number;
  /** Forecast days only: the day's highest chance of rain, in percent. */
  rainChance?: number;
  /** Last-year days only: the rain that fell that day, in inches. */
  rainInches?: number;
  conditions: string;
};

export type WeatherResult = {
  basis: "forecast" | typeof LAST_YEAR | "mixed";
  days: WeatherDay[];
  /** One factual line, e.g. "Highs 53–58°F, lows 43–48°F; rain on 2 of 5 days last year". */
  summary: string;
  source: "open-meteo";
  fetchedAt: number;
};

/** Weather that couldn't be fetched: the trip page shows an icon and "Weather not found" instead of a strip. */
export type WeatherUnavailable = { unavailable: true; reason: string };

export class WeatherError extends ToolFailure {}

/** The forecast reaches today + 15 (16 days in all). */
const FORECAST_DAYS = 16;
const MAX_DAYS = 21;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
// A day with a 50% or higher chance of rain, or at least 0.04 inches of it, counts as rainy in the summary.
const RAINY_CHANCE = 50;
const RAINY_INCHES = 0.04;

/** WMO weather codes as short words. */
const CONDITIONS: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};
export const conditionsFor = (code: number | undefined) => (code === undefined ? "Unknown" : (CONDITIONS[code] ?? "Unknown"));

type Daily = {
  time?: string[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
  weather_code?: (number | null)[];
};
type OpenMeteoResponse = { daily?: Daily; error?: boolean; reason?: string };

export type WeatherDeps = { today: string; fetchImpl?: typeof fetch };

// Tests and seed runs set SMARTTRIP_WEATHER=fixture so presentTrips never calls Open-Meteo for real. Not a product switch.
const defaultFetch = (): typeof fetch => (process.env.SMARTTRIP_WEATHER === "fixture" ? fixtureWeatherFetch : fetch);

const cache = new Map<string, { at: number; body: OpenMeteoResponse }>();

async function fetchDaily(url: string, fetchImpl: typeof fetch): Promise<Daily> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.body.daily ?? {};
  let body: OpenMeteoResponse;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    body = (await res.json()) as OpenMeteoResponse;
    if (!res.ok || body.error) throw new Error(body.reason ?? `HTTP ${res.status}`);
  } catch (err) {
    throw new WeatherError(`Open-Meteo didn't answer (${err instanceof Error ? err.message : String(err)}).`);
  }
  cache.set(url, { at: Date.now(), body });
  return body.daily ?? {};
}

/** Same date a year earlier; Feb 29 becomes Feb 28. */
function lastYear(date: string): string {
  const [y, m, d] = date.split("-");
  return m === "02" && d === "29" ? `${Number(y) - 1}-02-28` : `${Number(y) - 1}-${m}-${d}`;
}

const datesFrom = (start: string, end: string) => Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => addDays(start, i));
const round = (n: number) => Math.round(n);

/** "Highs 53–58°F, lows 43–48°F; rain likely on 2 of 3 days; rain on 1 of 2 days last year". */
export function weatherSummary(days: WeatherDay[]): string {
  const range = (values: number[]) => {
    const lo = round(Math.min(...values));
    const hi = round(Math.max(...values));
    return lo === hi ? `${lo}°F` : `${lo}–${hi}°F`;
  };
  const parts = [`Highs ${range(days.map((d) => d.highF))}, lows ${range(days.map((d) => d.lowF))}`];
  const forecast = days.filter((d) => d.basis === "forecast");
  const past = days.filter((d) => d.basis === "last year");
  if (forecast.length) {
    const rainy = forecast.filter((d) => (d.rainChance ?? 0) >= RAINY_CHANCE).length;
    parts.push(rainy ? `rain likely on ${rainy} of ${forecast.length} days` : "rain unlikely");
  }
  if (past.length) {
    const rainy = past.filter((d) => (d.rainInches ?? 0) >= RAINY_INCHES).length;
    parts.push(rainy ? `rain on ${rainy} of ${past.length} days last year` : "dry on these dates last year");
  }
  return parts.join("; ");
}

/**
 * The weather at an airport's city for startDate..endDate (inclusive). Throws WeatherError with a readable reason
 * (unknown airport, bad dates, Open-Meteo down).
 */
export async function getWeather(destination: string, startDate: string, endDate: string, deps: WeatherDeps): Promise<WeatherResult> {
  const { today, fetchImpl = defaultFetch() } = deps;
  const airport = await getAirport(destination);
  if (!airport) throw new WeatherError(`Unknown airport code "${destination}". Look it up with lookupAirport first.`);
  if (endDate < startDate) throw new WeatherError(`endDate (${endDate}) must be on or after startDate (${startDate}).`);
  if (startDate < today) throw new WeatherError(`startDate (${startDate}) is in the past (today is ${today}).`);
  if (daysBetween(startDate, endDate) + 1 > MAX_DAYS) throw new WeatherError(`Ask for at most ${MAX_DAYS} days at a time.`);

  const base = `latitude=${airport.latitude}&longitude=${airport.longitude}&timezone=auto&temperature_unit=fahrenheit`;
  const lastForecastDay = addDays(today, FORECAST_DAYS - 1);
  const dates = datesFrom(startDate, endDate);
  const near = dates.filter((d) => d <= lastForecastDay);
  const far = dates.filter((d) => d > lastForecastDay);

  const [forecast, archive] = await Promise.all([
    near.length
      ? fetchDaily(
          `https://api.open-meteo.com/v1/forecast?${base}&start_date=${near[0]}&end_date=${near.at(-1)}` +
            "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
          fetchImpl,
        )
      : null,
    far.length
      ? fetchDaily(
          `https://archive-api.open-meteo.com/v1/archive?${base}&start_date=${lastYear(far[0])}&end_date=${lastYear(far.at(-1)!)}` +
            "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&precipitation_unit=inch",
          fetchImpl,
        )
      : null,
  ]);

  const days: WeatherDay[] = [];
  const pick = (daily: Daily, date: string) => {
    const i = daily.time?.indexOf(date) ?? -1;
    const at = <T>(xs?: (T | null)[]) => (i >= 0 ? (xs?.[i] ?? undefined) : undefined);
    return {
      high: at(daily.temperature_2m_max),
      low: at(daily.temperature_2m_min),
      chance: at(daily.precipitation_probability_max),
      inches: at(daily.precipitation_sum),
      code: at(daily.weather_code),
    };
  };
  for (const date of near) {
    const d = pick(forecast!, date);
    if (d.high === undefined || d.low === undefined) continue;
    days.push({ date, basis: "forecast", highF: d.high, lowF: d.low, rainChance: d.chance, conditions: conditionsFor(d.code) });
  }
  for (const date of far) {
    const d = pick(archive!, lastYear(date));
    if (d.high === undefined || d.low === undefined) continue;
    days.push({ date, basis: "last year", highF: d.high, lowF: d.low, rainInches: d.inches, conditions: conditionsFor(d.code) });
  }
  if (days.length === 0) throw new WeatherError("Open-Meteo returned no weather for these dates.");

  const bases = new Set(days.map((d) => d.basis));
  return {
    basis: bases.size > 1 ? "mixed" : bases.has("forecast") ? "forecast" : LAST_YEAR,
    days,
    summary: weatherSummary(days),
    source: "open-meteo",
    fetchedAt: Date.now(),
  };
}

/** Weather for a trip, or why there is none. Never throws, so a weather outage can't break presenting trips. */
export async function tripWeather(
  destination: string,
  startDate: string,
  endDate: string,
  deps: WeatherDeps,
): Promise<WeatherResult | WeatherUnavailable> {
  try {
    return await getWeather(destination, startDate, endDate, deps);
  } catch (err) {
    return { unavailable: true, reason: err instanceof ToolFailure ? err.message : "Weather lookup failed." };
  }
}
