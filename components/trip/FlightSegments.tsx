import { Badge } from "@/components/ui/Badge";
import { formatDay, formatDuration, formatTime } from "@/lib/format";
import { flightSummary, type PublicTrip } from "@/lib/tripRow";

type Flight = PublicTrip["flight"];

/** "2026-12-11 23:30" -> "11:30 PM", with the day added when it isn't the flight's departure day. */
function when(at: string | undefined, departDate: string): string | null {
  if (!at) return null;
  const [date, time] = at.split(" ");
  if (!time) return null;
  return date === departDate ? formatTime(time) : `${formatTime(time)} ${formatDay(date)}`;
}

/** The flight's headline (times, stops, total time) and each leg with the layovers between them. */
export function FlightSegments({ flight }: { flight: Flight }) {
  const summary = flightSummary(flight);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {summary.times && (
          <p className="text-lg font-semibold text-ink">
            {summary.times}
            {summary.arriveOffset && (
              <>
                <sup aria-hidden="true" className="ml-0.5 text-xs font-medium text-muted">
                  {summary.arriveOffset}
                </sup>
                <span className="sr-only">, arrives the next day</span>
              </>
            )}
          </p>
        )}
        <p className="text-sm text-muted">
          {summary.stops}
          {summary.duration && ` · ${summary.duration} total`}
        </p>
        {summary.redEye && <Badge tone="warning">Red-eye</Badge>}
      </div>

      {flight.segments.length > 0 ? (
        <ol className="mt-4 space-y-3 border-l-2 border-line pl-4">
          {flight.segments.map((seg, i) => {
            const layover = i < flight.segments.length - 1 ? flight.layovers[i] : undefined;
            const leg = [seg.airline, seg.flightNumber].filter(Boolean).join(" ");
            return (
              <li key={`${seg.from}-${seg.to}-${i}`} className="text-sm">
                <p className="font-medium text-ink">
                  {seg.from} → {seg.to}
                  {leg && <span className="font-normal text-muted"> · {leg}</span>}
                </p>
                <p className="text-muted">
                  {[when(seg.departAt, flight.departDate), when(seg.arriveAt, flight.departDate)].filter(Boolean).join(" – ")}
                  {seg.durationMinutes !== undefined && ` · ${formatDuration(seg.durationMinutes)}`}
                </p>
                {layover && (
                  <p className="mt-3 rounded-md bg-raised px-3 py-1.5 text-muted">
                    {layover.minutes !== undefined ? `${formatDuration(layover.minutes)} layover` : "Layover"} in{" "}
                    {layover.name ?? layover.airport}
                    {layover.overnight && <span className="font-medium text-warning"> · overnight</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        // Sample flights with stops don't list their legs; say what the data has instead.
        <p className="mt-3 text-sm text-muted">
          {[summary.airline, summary.flightNumbers].filter(Boolean).join(" · ")}
          {flight.notes && ` · ${flight.notes}`}
        </p>
      )}
    </div>
  );
}
