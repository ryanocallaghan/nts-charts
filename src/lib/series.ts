// Turn query rows into chart-ready series for <TimeChart>.
import type { VizData } from "../scripts/charts.ts";
import { isoWeekKey, isoWeekStart, periodLabel } from "./format.ts";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yy = (y: number) => `’${String(y).slice(2)}`;

export function monthlyBars(rows: { month: string; episodes: number }[]): VizData {
  return {
    kind: "bars",
    name: "Episodes",
    x: rows.map((r) => { const [y, m] = r.month.split("-").map(Number); return `${MON[m - 1]} ${yy(y)}`; }),
    tip: rows.map((r) => periodLabel("month", r.month)),
    y: rows.map((r) => r.episodes),
  };
}

/** Weekly rank line with gaps (null) for weeks off the chart, so the line breaks. */
export function rankLine(rows: { week: string; rank: number }[], max = 50): VizData {
  const ranks = new Map(rows.map((r) => [r.week, r.rank]));
  const weeks: string[] = [];
  if (rows.length) {
    const last = rows[rows.length - 1].week;
    for (let d = isoWeekStart(rows[0].week); ; d.setUTCDate(d.getUTCDate() + 7)) {
      const key = isoWeekKey(d);
      weeks.push(key);
      if (key >= last) break;
    }
  }
  return {
    kind: "rank",
    name: "Weekly rank",
    max,
    x: weeks.map((w) => { const d = isoWeekStart(w); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${yy(d.getUTCFullYear())}`; }),
    tip: weeks.map((w) => periodLabel("week", w)),
    y: weeks.map((w) => ranks.get(w) ?? null),
  };
}
