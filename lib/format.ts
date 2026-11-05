// Display formatting shared by the results and detail pages. Dates are calendar days ("2026-12-11"), not
// instants, so they are formatted in UTC: Dec 11 stays Dec 11 whatever the viewer's time zone.

const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** 871 -> "$871", 1249.5 -> "$1,249.50". Cents only when there are some. */
export const formatMoney = (amount: number) => (Number.isInteger(amount) ? money0 : money2).format(amount);

/** 354 -> "5h 54m", 60 -> "1h", 45 -> "45m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

const asUtc = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "2026-12-11" -> "Fri, Dec 11" */
export const formatDay = (isoDate: string) => dayFormat.format(asUtc(isoDate));

/** "2026-12-11", "2026-12-14" -> "Dec 11–14"; across months "Dec 28 – Jan 2". */
export function formatDayRange(start: string, end: string): string {
  const a = monthDay.format(asUtc(start));
  const b = monthDay.format(asUtc(end));
  if (start.slice(0, 7) === end.slice(0, 7)) return `${a}–${b.split(" ")[1]}`;
  return `${a} – ${b}`;
}

/** "23:10" -> "11:10 PM", "07:05" -> "7:05 AM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Whole days from one calendar date to another: "2026-12-11", "2026-12-12" -> 1. */
export const daysBetween = (from: string, to: string) => Math.round((asUtc(to).getTime() - asUtc(from).getTime()) / 86_400_000);

/** 1 -> "1 traveler", 2 -> "2 travelers". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
