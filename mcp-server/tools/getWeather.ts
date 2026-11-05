import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { jsonResult, toolError, ToolFailure } from "../lib/results";
import type { RunContext } from "../lib/runContext";
import { airportCode, isoDate } from "../lib/schemas";
import { getWeather } from "../lib/weather";

export const getWeatherInput = z.object({
  destination: airportCode("destination").describe('The city, as its 3-letter airport code (e.g. "SAN").'),
  startDate: isoDate("startDate").describe("First day, YYYY-MM-DD."),
  endDate: isoDate("endDate").describe("Last day, YYYY-MM-DD (at most 21 days after startDate)."),
});

export function registerGetWeather(server: McpServer, ctx: RunContext) {
  server.registerTool(
    "getWeather",
    {
      title: "Get weather",
      description:
        "Daily weather for a destination from Open-Meteo: the forecast for days up to 16 days ahead, and for later days last " +
        "year's actual weather on the same dates (labelled; it is not a forecast). Returns { basis, days: [{ date, basis, highF, " +
        "lowF, rainChance?, rainInches?, conditions }], summary }. presentTrips already adds weather to every trip, so call this " +
        "only to compare destinations when the weather is the point of the request (e.g. \"somewhere warm\").",
      inputSchema: getWeatherInput,
      annotations: { readOnlyHint: true },
    },
    async ({ destination, startDate, endDate }) => {
      try {
        const today = ctx.today ?? new Date().toLocaleDateString("en-CA");
        const { basis, days, summary } = await getWeather(destination, startDate, endDate, { today });
        return jsonResult({ basis, days, summary });
      } catch (err) {
        if (err instanceof ToolFailure) return toolError(err.message);
        throw err;
      }
    },
  );
}
