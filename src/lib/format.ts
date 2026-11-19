/** The site's public name (the repo, URL and Cloudflare project stay "nts-charts"). */
export const SITE_NAME = "Top of the NTS";

export type PeriodType = "week" | "rolling" | "month" | "year" | "all";
export type DatedPeriod = Exclude<PeriodType, "all">;
export const DATED_PERIODS: DatedPeriod[] = ["week", "rolling", "month", "year"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Monday (UTC) of an ISO week key like "2026-W47". */
export function isoWeekStart(key: string): Date {
  const [y, w] = key.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
  return monday;
}

/** ISO week key for a date, matching SQLite's strftime('%G-W%V'). */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3); // Thursday of this week decides the year
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function currentPeriodKey(type: PeriodType, now = new Date()): string {
  if (type === "week" || type === "rolling") return isoWeekKey(now);
  if (type === "all") return "all";
  if (type === "month") return now.toISOString().slice(0, 7);
  return String(now.getUTCFullYear());
}

export function periodLabel(type: PeriodType, key: string): string {
  if (type === "all") return "All time";
  if (type === "year") return key;
  if (type === "month") {
    const [y, m] = key.split("-").map(Number);
    return `${MONTHS_LONG[m - 1]} ${y}`;
  }
  const start = isoWeekStart(key);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  if (type === "rolling") {
    start.setUTCDate(start.getUTCDate() - 21);
    const from = start.getUTCFullYear() === end.getUTCFullYear()
      ? `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`
      : `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
    return `4 weeks · ${from} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  }
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const range = sameMonth
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`
    : `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
  return `Week ${Number(key.split("-W")[1])} · ${range} ${end.getUTCFullYear()}`;
}

/**
 * A chart page's heading: the chart's name, plus a smaller line with its type and dates.
 *   week    -> "Week 47"            / "Weekly chart · 16–22 Nov 2026"
 *   rolling -> "4 weeks to 22 Nov"  / "4-week chart · 26 Oct – 22 Nov 2026"
 *   month   -> "November 2026"      / "Monthly chart"
 */
export function periodHeading(type: PeriodType, key: string): { title: string; sub: string; dates: string } {
  if (type === "all") return { title: "All time", sub: "", dates: "" };
  if (type === "year") return { title: key, sub: "Yearly chart", dates: "" };
  if (type === "month") return { title: periodLabel(type, key), sub: "Monthly chart", dates: "" };
  const [name, dates] = periodLabel(type, key).split(" · ");
  if (type === "week") return { title: name, sub: `Weekly chart · ${dates}`, dates };
  const end = isoWeekStart(key);
  end.setUTCDate(end.getUTCDate() + 6);
  return { title: `4 weeks to ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`, sub: `4-week chart · ${dates}`, dates };
}

const DAY = 86_400_000;

export interface Window { from: string; to: string } // ISO timestamps, [from, to)

/**
 * The 4-week window ending in ISO week `key`, cut off at `asOf` while it's in progress, and exactly
 * the same elapsed time from the start of the previous 4 weeks, for like-for-like comparisons.
 */
export function compareWindows(key: string, asOf: Date): { current: Window; previous: Window; previousFull: Window; days: number } {
  const start = isoWeekStart(rollingStartKey(key));
  const end = new Date(isoWeekStart(key).getTime() + 7 * DAY);
  const cut = new Date(Math.min(end.getTime(), Math.max(asOf.getTime(), start.getTime() + DAY)));
  const elapsed = cut.getTime() - start.getTime();
  const days = Math.ceil(elapsed / DAY);
  const prevStart = new Date(start.getTime() - 28 * DAY);
  return {
    current: { from: start.toISOString(), to: cut.toISOString() },
    // Same elapsed time to the millisecond: rounding to whole days would hand the previous window extra hours.
    previous: { from: prevStart.toISOString(), to: new Date(prevStart.getTime() + elapsed).toISOString() },
    previousFull: { from: prevStart.toISOString(), to: start.toISOString() },
    days,
  };
}

export interface Change { text: string; dir: "up" | "down" | "same"; label: string }

/** "+12%" for counts, "+1.5 pts" for percentages; null when there's nothing to compare with. */
export function formatChange(current: number, previous: number, unit: "pct" | "pts"): Change | null {
  if (unit === "pct" && previous <= 0) return null;
  const delta = unit === "pct" ? ((current - previous) / previous) * 100 : current - previous;
  const rounded = Math.round(delta * 10) / 10;
  const dir = rounded > 0 ? "up" : rounded < 0 ? "down" : "same";
  const abs = Math.abs(unit === "pct" ? Math.round(delta) : rounded);
  const text = dir === "same" ? "No change" : `${dir === "up" ? "+" : "−"}${abs.toLocaleString("en-GB")}${unit === "pct" ? "%" : " pts"}`;
  return { text, dir, label: `${text} vs the previous 4 weeks` };
}

/** The same ISO week number `years` years earlier (week 53 falls back to 52 in 52-week years). */
export function weekYearsAgo(key: string, years: number): string {
  const [y, w] = key.split("-W").map(Number);
  const candidate = `${y - years}-W${String(w).padStart(2, "0")}`;
  return isoWeekKey(isoWeekStart(candidate)) === candidate ? candidate : `${y - years}-W52`;
}

/** The first ISO week of a 4-week chart ending in `key`. */
export function rollingStartKey(key: string): string {
  const d = isoWeekStart(key);
  d.setUTCDate(d.getUTCDate() - 21);
  return isoWeekKey(d);
}

/** "26 Oct – 18 Nov 2026", "16–18 Nov 2026" (years on both ends only when they differ). */
export function dateRange(from: Date, to: Date): string {
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  if (sameYear && from.getUTCMonth() === to.getUTCMonth()) {
    const end = `${to.getUTCDate()} ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
    return from.getUTCDate() === to.getUTCDate() ? end : `${from.getUTCDate()}–${end}`;
  }
  const d = (x: Date, year: boolean) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}${year ? ` ${x.getUTCFullYear()}` : ""}`;
  return `${d(from, !sameYear)} – ${d(to, true)}`;
}

/** Start (inclusive) and end (exclusive) of a chart period. */
export function periodBounds(type: Exclude<PeriodType, "all">, key: string): { start: Date; end: Date } {
  if (type === "week") { const start = isoWeekStart(key); return { start, end: new Date(start.getTime() + 7 * DAY) }; }
  if (type === "rolling") return { start: isoWeekStart(rollingStartKey(key)), end: new Date(isoWeekStart(key).getTime() + 7 * DAY) };
  if (type === "month") { const [y, m] = key.split("-").map(Number); return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }; }
  const y = Number(key);
  return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) };
}

/**
 * The dates a chart covers, for labels shared by every page. While the period is still running
 * (the data stops before its end) it's the dates so far: "26 Oct – 18 Nov 2026, so far".
 * Finished periods give their full range, or nothing for months and years (the title says it).
 */
export function periodDates(type: PeriodType, key: string, asOf: Date): { text: string; inProgress: boolean } {
  if (type === "all") return { text: "", inProgress: false };
  const { start, end } = periodBounds(type, key);
  if (asOf < end) return { text: `${dateRange(start, asOf < start ? start : asOf)}, so far`, inProgress: true };
  if (type === "month" || type === "year") return { text: "", inProgress: false };
  return { text: dateRange(start, new Date(end.getTime() - 1)), inProgress: false };
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const typeLabel: Record<PeriodType, string> = { week: "Weekly", rolling: "4 weeks", month: "Monthly", year: "Yearly", all: "All time" };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

export const ntsEpisodeUrl = (show: string, episode: string) => `https://www.nts.live/shows/${show}/episodes/${episode}`;
export const ntsShowUrl = (show: string) => `https://www.nts.live/shows/${show}`;
