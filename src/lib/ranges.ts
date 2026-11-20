// Date ranges for charts for any dates (/charts/range/, /charts/compare/): whole UTC days, both ends
// included, inside the charts' first and latest days, up to RANGE_MAX_DAYS.
import { dateRange, dayKey, formatDate, parseDay, periodBounds, periodLabel, seasonKey } from "./format.ts";

export const DAY = 86_400_000;
/** The longest range a chart for any dates covers (3 years); longer ones have the yearly and all-time charts. */
export const RANGE_MAX_DAYS = 1096;
/** The longest range that gets arrows: ranking the time before as well doubles the work, and over years says little. */
export const ARROWS_MAX_DAYS = 366;

export interface DayRange {
  start: Date; // first day, midnight UTC
  last: Date;  // last day, midnight UTC
  end: Date;   // the day after the last (exclusive)
  days: number;
}

export function dayRange(start: Date, last: Date): DayRange {
  return { start, last, end: new Date(last.getTime() + DAY), days: Math.round((last.getTime() - start.getTime()) / DAY) + 1 };
}

/**
 * A range from "2019-06-01" and "2019-08-31". Days before the charts begin or after the latest data
 * are pulled in to those; anything else wrong gives a `problem` to show instead of a chart.
 */
export function parseRange(from: string | null, to: string | null, bounds: { first: Date; last: Date }): DayRange | { problem: string } {
  let start = parseDay(from);
  let last = parseDay(to);
  if (!start || !last) return { problem: "Dates need to be real days." };
  if (start < bounds.first) start = bounds.first;
  if (last > bounds.last) last = bounds.last;
  if (start > bounds.last) return { problem: `The charts go up to ${formatDate(bounds.last.toISOString())} so far.` };
  if (start > last) return { problem: "The start date is after the end date." };
  const r = dayRange(start, last);
  return r.days > RANGE_MAX_DAYS ? { problem: "That’s more than 3 years." } : r;
}

/** The same number of days just before, if the charts go back that far. */
export function rangeBefore(r: DayRange, first: Date): DayRange | null {
  const start = new Date(r.start.getTime() - r.days * DAY);
  return start < first ? null : dayRange(start, new Date(r.start.getTime() - DAY));
}

/** The same days `years` earlier (29 February becomes 1 March), or null if that's before the charts. */
export function rangeYearsBefore(r: DayRange, years: number, first: Date): DayRange | null {
  const shift = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));
  const start = shift(r.start);
  return start < first ? null : dayRange(start, shift(r.last));
}

/** Address parameters for a range: { from, to }, or with a prefix { a_from, a_to }. */
export function rangeParams(r: DayRange, prefix = ""): Record<string, string> {
  return { [`${prefix}from`]: dayKey(r.start), [`${prefix}to`]: dayKey(r.last) };
}

/** A range's name: "2019", "Summer 2019" or "June 2019" when it's exactly one, else its dates. */
export function rangeName(r: DayRange): string {
  const same = (b: { start: Date; end: Date }) => b.start.getTime() === r.start.getTime() && b.end.getTime() === r.end.getTime();
  const year = String(r.start.getUTCFullYear());
  if (same(periodBounds("year", year))) return year;
  const season = seasonKey(r.start);
  if (same(periodBounds("season", season))) return periodLabel("season", season);
  const month = dayKey(r.start).slice(0, 7);
  if (same(periodBounds("month", month))) return periodLabel("month", month);
  return dateRange(r.start, r.last);
}
