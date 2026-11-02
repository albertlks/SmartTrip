import { ToolFailure } from "./results";

export type Source = "mock" | "fixture" | "serpapi";
export type ProviderKind = "FLIGHT" | "HOTEL" | "ACTIVITY";

const SOURCES: Source[] = ["mock", "fixture", "serpapi"];

/** Where a tool gets its data, from FLIGHT_PROVIDER, HOTEL_PROVIDER, or ACTIVITY_PROVIDER. Default mock. */
export function providerFor(kind: ProviderKind): Source {
  const name = `${kind}_PROVIDER`;
  const value = (process.env[name] ?? "mock").trim().toLowerCase();
  if (!SOURCES.includes(value as Source)) {
    throw new ToolFailure(`${name}="${value}" is not valid. Use one of: ${SOURCES.join(", ")}.`);
  }
  return value as Source;
}
