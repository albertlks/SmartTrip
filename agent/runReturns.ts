import { ToolFailure } from "../mcp-server/lib/results";
import { findReturnFlights, type ReturnFlights } from "../mcp-server/lib/returnFlights";
import { newRunContext } from "../mcp-server/lib/runContext";
import { getRun, saveRun, type SavedRun } from "./runStore";

export type ReturnFlightsResponse = ReturnFlights | { error: string };

// Two clicks at once (or two tabs) share one fetch, so they can't spend two SerpApi searches.
const inFlight = new Map<string, Promise<ReturnFlightsResponse>>();

/**
 * The return options for one trip of a run: saved on the run after the first fetch, so opening the trip again costs
 * nothing. Returns null for an unknown trip; failures come back as { error } with a readable reason, and aren't saved.
 */
export async function getReturnFlights(run: SavedRun, tripId: string): Promise<ReturnFlightsResponse | null> {
  const trip = run.trips?.find((t) => t.tripId === tripId);
  if (!trip) return null;
  const saved = run.returns?.[tripId];
  if (saved) return saved;

  const key = `${run.runId}/${tripId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const work = (async (): Promise<ReturnFlightsResponse> => {
    const returnDate = trip.flight.returnDate ?? run.request?.returnDate ?? trip.hotel.checkOut;
    try {
      // One live search at most per request.
      const result = await findReturnFlights(trip.flight, returnDate, { ...newRunContext(run.runId), maxSerpapiCalls: 1 });
      // Re-read the run so a save made meanwhile (another trip's returns) isn't lost.
      const latest = (await getRun(run.runId)) ?? run;
      await saveRun({ ...latest, returns: { ...latest.returns, [tripId]: result } });
      return result;
    } catch (err) {
      if (!(err instanceof ToolFailure)) console.error(`[run ${run.runId}] return flights for ${tripId}`, err);
      const reason = err instanceof ToolFailure ? err.message : "something went wrong.";
      return { error: `Return flight details unavailable: ${reason}` };
    }
  })();
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}
