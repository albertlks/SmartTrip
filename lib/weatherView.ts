import type { WeatherDay, WeatherResult, WeatherUnavailable } from "@/mcp-server/lib/weather";
import { formatDay } from "./format";

// What the weather strip shows, worked out from the saved weather only. Last year's actuals are always labelled,
// so they can't be mistaken for a forecast.

export type TripWeather = WeatherResult | WeatherUnavailable | null;
export type WeatherIcon = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm" | "unknown";

export type DayView = {
  date: string;
  /** "Fri" */
  weekday: string;
  /** "Dec 11" */
  day: string;
  icon: WeatherIcon;
  conditions: string;
  high: string;
  low: string;
  /** "80% rain" (forecast), "0.58 in" or "Dry" (last year), or null when unknown. */
  rain: string | null;
  tag: "Forecast" | "Last year";
  /** Everything above in one sentence, for screen readers. */
  label: string;
};

export type WeatherView =
  | { kind: "none" }
  | { kind: "unavailable"; reason: string }
  | { kind: "days"; heading: string; note: string | null; summary: string; mixed: boolean; days: DayView[] };

const LAST_YEAR_NOTE = "Too far ahead for a forecast, so this is what the weather was on the same dates last year.";

export function iconFor(conditions: string): WeatherIcon {
  const c = conditions.toLowerCase();
  if (c.includes("thunder")) return "storm";
  if (c.includes("snow")) return "snow";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "rain";
  if (c.includes("fog")) return "fog";
  if (c.includes("overcast")) return "cloud";
  if (c.includes("partly")) return "partly";
  if (c.includes("clear")) return "sun";
  return "unknown";
}

function rainText(d: WeatherDay): string | null {
  if (d.basis === "forecast") return d.rainChance === undefined ? null : `${d.rainChance}% rain`;
  if (d.rainInches === undefined) return null;
  return d.rainInches >= 0.01 ? `${d.rainInches.toFixed(2)} in` : "Dry";
}

function dayView(d: WeatherDay): DayView {
  const [weekday, day] = formatDay(d.date).split(", ");
  const high = `${Math.round(d.highF)}°`;
  const low = `${Math.round(d.lowF)}°`;
  const rain = rainText(d);
  const spoken = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const rainSpoken =
    d.basis === "forecast"
      ? d.rainChance === undefined ? "" : `, ${d.rainChance}% chance of rain`
      : rain === null ? "" : rain === "Dry" ? ", no rain" : `, ${d.rainInches!.toFixed(2)} inches of rain`;
  return {
    date: d.date,
    weekday,
    day,
    icon: iconFor(d.conditions),
    conditions: d.conditions,
    high,
    low,
    rain,
    tag: d.basis === "forecast" ? "Forecast" : "Last year",
    label:
      `${spoken}: ${d.conditions}, high ${high}F, low ${low}F${rainSpoken}, ` +
      (d.basis === "forecast" ? "forecast" : "last year's actuals for this date"),
  };
}

export function weatherView(w: TripWeather | undefined): WeatherView {
  if (!w) return { kind: "none" };
  if ("unavailable" in w) return { kind: "unavailable", reason: w.reason };
  const mixed = w.basis === "mixed";
  return {
    kind: "days",
    heading: w.basis === "forecast" ? "Forecast" : mixed ? "Forecast, then last year's actuals" : "Last year's actuals for these dates",
    note: w.basis === "forecast" ? null : LAST_YEAR_NOTE,
    summary: w.summary,
    mixed,
    days: w.days.map(dayView),
  };
}

/** The range of highs for a results row, e.g. "53–58°F"; null when there's no weather. */
export function weatherHint(w: TripWeather | undefined): string | null {
  if (!w || "unavailable" in w || w.days.length === 0) return null;
  const highs = w.days.map((d) => Math.round(d.highF));
  const lo = Math.min(...highs);
  const hi = Math.max(...highs);
  return lo === hi ? `${lo}°F` : `${lo}–${hi}°F`;
}
