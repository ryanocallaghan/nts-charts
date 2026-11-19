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


/**
 * SVG path for a small rank sparkline: rank 1 at the top, `max` at the bottom, a break wherever the
 * item was off the chart (null). Returns the path and the last point (for an end dot).
 */
export function sparklinePath(ranks: (number | null)[], width: number, height: number, max = 50, pad = 4) {
  const n = ranks.length;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  const y = (r: number) => pad + ((Math.min(r, max) - 1) * (height - 2 * pad)) / (max - 1);
  let d = "";
  let drawing = false;
  let last: { x: number; y: number } | null = null;
  ranks.forEach((r, i) => {
    if (r == null) { drawing = false; return; }
    const px = Math.round(x(i) * 10) / 10, py = Math.round(y(r) * 10) / 10;
    d += `${drawing ? "L" : "M"}${px} ${py}`;
    drawing = true;
    last = { x: px, y: py };
  });
  return { d, last: last as { x: number; y: number } | null };
}

/** One genre's weekly share (%) for a small multiple; `max` is shared across the set. */
export function weekShareLine(weeks: string[], shares: (number | null)[], max: number): VizData {
  return {
    kind: "share",
    name: "Share of episodes",
    max,
    x: weeks.map((w) => { const d = isoWeekStart(w); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; }),
    tip: weeks.map((w) => periodLabel("week", w)),
    y: shares,
  };
}

/** A genre's share (%) of tagged episodes, year by year. */
export function yearShareLine(rows: { year: string; tagged: number; total: number }[]): VizData {
  const shares = rows.map((r) => (r.total ? Math.round((1000 * r.tagged) / r.total) / 10 : null));
  const peak = Math.max(0, ...shares.filter((v): v is number => v != null));
  return {
    kind: "share",
    name: "Share of tagged episodes",
    max: Math.max(5, Math.ceil(peak / 5) * 5),
    x: rows.map((r) => r.year),
    tip: rows.map((r) => `${r.year} · ${r.tagged.toLocaleString("en-GB")} of ${r.total.toLocaleString("en-GB")} episodes`),
    y: shares,
  };
}

/** The top genres' shares stacked per quarter (biggest at the bottom); x labels show the year at each Q1. */
export function genreStack(river: { quarters: string[]; series: { name: string; values: number[] }[] }): VizData {
  const peak = Math.max(0, ...river.quarters.map((_, i) => river.series.reduce((sum, s) => sum + s.values[i], 0)));
  return {
    kind: "stack",
    name: "Share of genre tags",
    x: river.quarters.map((q) => (q.endsWith("-Q1") ? q.slice(0, 4) : "")),
    tip: river.quarters.map((q) => `${q.slice(5)} ${q.slice(0, 4)}`),
    y: [],
    max: Math.ceil(peak / 10) * 10,
    series: river.series.map((s, i) => ({ name: s.name, y: s.values, color: `--cat-${i + 1}` })),
  };
}
