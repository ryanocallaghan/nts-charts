// Turn query rows into chart-ready series for <TimeChart>.
import type { VizData } from "../scripts/charts.ts";
import { isoWeekKey, isoWeekStart, periodLabel } from "./format.ts";

/** How a value reads in tooltips and data tables. */
export function formatViz(kind: VizData["kind"], v: number | null): string {
  if (v == null) return kind === "rank" ? "Not charted" : "—";
  if (kind === "rank") return `#${v}`;
  if (kind === "hbar" || kind === "share") return `${v.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString("en-GB");
}

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

/** Horizontal bars of genre share (%), with the change vs the previous 4 weeks in the tooltip. */
export function genreBars(rows: { genre: string; share: number; prevShare: number }[]): VizData {
  return {
    kind: "hbar",
    name: "Share of episodes",
    x: rows.map((r) => r.genre),
    tip: rows.map((r) => {
      const d = Math.round((r.share - r.prevShare) * 10) / 10;
      return `${r.genre} · ${d === 0 ? "no change" : `${d > 0 ? "+" : "−"}${Math.abs(d)} pts`} vs the previous 4 weeks`;
    }),
    y: rows.map((r) => Math.round(r.share * 10) / 10),
  };
}

/** One genre's monthly share (%) for a small multiple; `max` is shared across the set. */
export function shareLine(months: string[], shares: (number | null)[], max: number): VizData {
  return {
    kind: "share",
    name: "Share of episodes",
    max,
    x: months.map((m) => { const [y, mo] = m.split("-").map(Number); return `${MON[mo - 1]} ${yy(y)}`; }),
    tip: months.map((m) => periodLabel("month", m)),
    y: shares,
  };
}
