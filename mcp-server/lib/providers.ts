import { ToolFailure } from "./results";

export type Source = "mock" | "fixture" | "serpapi";
export type ProviderKind = "FLIGHT" | "HOTEL" | "ACTIVITY";

const SOURCES: Source[] = ["mock", "fixture", "serpapi"];

let announced = false;

/**
 * DEMO_FALLBACK=offline: the manual switch for a demo when SerpApi or the network fails. Every search uses a saved
 * fixture when there is one and sample data otherwise (each badged on screen), and nothing calls SerpApi.
 */
export function demoOffline(): boolean {
  const on = (process.env.DEMO_FALLBACK ?? "").trim().toLowerCase() === "offline";
  if (on && !announced) {
    announced = true;
    console.error("[demo] DEMO_FALLBACK=offline: saved fixtures where they exist, sample data otherwise; no SerpApi calls.");
  }
  return on;
}

/**
 * Where a tool gets its data, from FLIGHT_PROVIDER, HOTEL_PROVIDER, or ACTIVITY_PROVIDER. Default mock.
 * With DEMO_FALLBACK=offline it is always "fixture", and providers fall back to mock when no fixture is saved.
 */
export function providerFor(kind: ProviderKind): Source {
  if (demoOffline()) return "fixture";
  const name = `${kind}_PROVIDER`;
  const value = (process.env[name] ?? "mock").trim().toLowerCase();
  if (!SOURCES.includes(value as Source)) {
    throw new ToolFailure(`${name}="${value}" is not valid. Use one of: ${SOURCES.join(", ")}.`);
  }
  return value as Source;
}
