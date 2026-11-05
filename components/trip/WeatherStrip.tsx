import { cx } from "@/components/ui/cx";
import { weatherView, type TripWeather, type WeatherIcon } from "@/lib/weatherView";

// Simple line icons (24x24, stroked), so no icon library is needed.
const CLOUD = "M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 11.1 3.5 3.5 0 0 0 7 18z";
const PATHS: Record<WeatherIcon, string[]> = {
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
  partly: ["M8 9a3 3 0 1 1 5.6-1.5", "M8 3v1M3.5 8H2.5M4.6 4.6l.7.7", "M9 20h8a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 8 13.6 3.2 3.2 0 0 0 9 20z"],
  cloud: [CLOUD],
  fog: ["M7 13h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 6.1", "M4 17h16M6 21h12"],
  rain: ["M7 14h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 7.1 3.5 3.5 0 0 0 7 14z", "M8 17l-1 3M12 17l-1 3M16 17l-1 3"],
  snow: ["M7 14h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 7.1 3.5 3.5 0 0 0 7 14z", "M8 18h.01M12 18h.01M16 18h.01M10 21h.01M14 21h.01"],
  storm: ["M7 14h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 7.1 3.5 3.5 0 0 0 7 14z", "M12 14l-2 4h3l-2 4"],
  unknown: [CLOUD, "M11 12h.01"],
};

function Icon({ name, className }: { name: WeatherIcon | "unavailable"; className?: string }) {
  const paths = name === "unavailable" ? [CLOUD, "M3 3l18 18"] : PATHS[name];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cx("h-6 w-6", className)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A card per day of the stay, labelled forecast or last year's actuals; "Weather not found" when it couldn't be fetched. */
export function WeatherStrip({ weather }: { weather: TripWeather | undefined }) {
  const view = weatherView(weather);
  if (view.kind === "none") return null;
  if (view.kind === "unavailable") {
    return (
      <div className="flex items-start gap-3 text-sm">
        <Icon name="unavailable" className="mt-0.5 shrink-0 text-muted" />
        <div>
          <p className="font-medium text-ink">Weather not found</p>
          <p className="text-xs text-muted">{view.reason}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm font-medium text-ink">{view.heading}</p>
      {view.note && <p className="text-xs text-muted">{view.note}</p>}
      {/* Cards scroll sideways inside the section on narrow screens; the page itself never scrolls sideways. */}
      <ul className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {view.days.map((d) => (
          <li
            key={d.date}
            aria-label={d.label}
            className="flex min-w-[5.5rem] flex-1 flex-col items-center gap-1 rounded-lg border border-line bg-raised px-2 py-3 text-center"
          >
            <span aria-hidden="true" className="text-xs font-medium text-muted">
              {d.weekday} {d.day}
            </span>
            <span aria-hidden="true" title={d.conditions} className="text-accent">
              <Icon name={d.icon} />
            </span>
            <span aria-hidden="true" className="text-sm tabular-nums text-ink">
              <span className="font-semibold">{d.high}</span> <span className="text-muted">{d.low}</span>
            </span>
            {d.rain && (
              <span aria-hidden="true" className="text-xs tabular-nums text-muted">
                {d.rain}
              </span>
            )}
            {view.mixed && (
              <span aria-hidden="true" className="text-[0.65rem] uppercase tracking-wide text-muted">
                {d.tag}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted">{view.summary}</p>
    </div>
  );
}
