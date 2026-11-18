export type PeriodType = "week" | "month" | "year" | "all";
export type DatedPeriod = Exclude<PeriodType, "all">;
export const DATED_PERIODS: DatedPeriod[] = ["week", "month", "year"];

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
  if (type === "week") return isoWeekKey(now);
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
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const range = sameMonth
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`
    : `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
  return `Week ${Number(key.split("-W")[1])} · ${range} ${end.getUTCFullYear()}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const typeLabel: Record<PeriodType, string> = { week: "Weekly", month: "Monthly", year: "Yearly", all: "All time" };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

export const ntsEpisodeUrl = (show: string, episode: string) => `https://www.nts.live/shows/${show}/episodes/${episode}`;
export const ntsShowUrl = (show: string) => `https://www.nts.live/shows/${show}`;
