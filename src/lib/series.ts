// Turn query rows into chart-ready series for <TimeChart>.
import type { VizData } from "../scripts/charts.ts";
import { dateRange, isoWeekKey, isoWeekStart, periodLabel } from "./format.ts";

/** How a value reads in tooltips and data tables. */
export function formatViz(kind: VizData["kind"], v: number | null): string {
  if (v == null) return kind === "rank" ? "Not charted" : "—";
  if (kind === "rank") return `#${v}`;
  if (kind === "hbar" || kind === "share") return `${v.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString("en-GB");
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTER_MONTHS = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];
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

export interface ChartRun { from: string; to: string; weeks: number; peak: number; peakWeek: string; dates: string }

/** Unbroken runs of weeks on the chart (rows in week order), with each run's dates and peak. */
export function chartRuns(rows: { week: string; rank: number }[]): ChartRun[] {
  const runs: ChartRun[] = [];
  let prev = "";
  for (const r of rows) {
    const run = runs.at(-1);
    if (run && prev && isoWeekKey(new Date(isoWeekStart(prev).getTime() + 7 * 86_400_000)) === r.week) {
      run.to = r.week;
      run.weeks++;
      if (r.rank < run.peak) { run.peak = r.rank; run.peakWeek = r.week; }
    } else {
      runs.push({ from: r.week, to: r.week, weeks: 1, peak: r.rank, peakWeek: r.week, dates: "" });
    }
    prev = r.week;
  }
  for (const run of runs) run.dates = dateRange(isoWeekStart(run.from), new Date(isoWeekStart(run.to).getTime() + 6 * 86_400_000));
  return runs;
}

/**
 * A chart history too thin for a line: under 15 weeks, or mostly separate appearances (more runs than
 * half its weeks). Those draw as dots with a list of runs; longer histories as a line.
 */
export function sparseHistory(weeks: number, runs: number): boolean {
  return weeks < 15 || runs > weeks / 2;
}

/** Weekly rank line with gaps (null) for weeks off the chart, so the line breaks. `dots`: dots only, no line or zoom. */
export function rankLine(rows: { week: string; rank: number }[], max = 50, dots = false): VizData {
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
    ...(dots ? { dots: true } : {}),
  };
}

/**
 * Episodes each week across the whole archive, for picking dates by dragging across it. `days` are the
 * weeks' Mondays; `selected` the first and last weeks of the range shown (indexes), if any.
 */
export function rangeTimeline(rows: readonly { week: string; episodes: number }[], selected: { start: Date; last: Date } | null, lastDay: Date, query: string): VizData {
  const index = (d: Date) => rows.findIndex((r) => r.week === isoWeekKey(d));
  const from = selected ? index(selected.start) : -1;
  const to = selected ? index(selected.last) : -1;
  return {
    kind: "timeline",
    name: "Episodes",
    // Years on the axis, at each year's first week; the tooltip gives the week's dates.
    x: rows.map((r, i) => (i === 0 || r.week.slice(0, 4) !== rows[i - 1].week.slice(0, 4) ? r.week.slice(0, 4) : "")),
    tip: rows.map((r) => periodLabel("week", r.week).split(" · ")[1]),
    y: rows.map((r) => r.episodes),
    days: rows.map((r) => isoWeekStart(r.week).toISOString().slice(0, 10)),
    last: lastDay.toISOString().slice(0, 10),
    query,
    ...(from >= 0 && to >= 0 ? { selected: [from, to] as [number, number] } : {}),
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

/** The top genres' shares stacked per three months (biggest at the bottom); x labels show the year at each January. */
export function genreStack(river: { quarters: string[]; series: { name: string; values: number[] }[] }): VizData {
  const peak = Math.max(0, ...river.quarters.map((_, i) => river.series.reduce((sum, s) => sum + s.values[i], 0)));
  return {
    kind: "stack",
    name: "Share of genre tags",
    x: river.quarters.map((q) => (q.endsWith("-Q1") ? q.slice(0, 4) : "")),
    tip: river.quarters.map((q) => `${QUARTER_MONTHS[Number(q.slice(6)) - 1]} ${q.slice(0, 4)}`),
    y: [],
    max: Math.ceil(peak / 10) * 10,
    series: river.series.map((s, i) => ({ name: s.name, y: s.values, color: `--cat-${i + 1}` })),
  };
}

/**
 * An artist's connections graph: the artist, their top shows and their most related artists, linked
 * to the artist and to each other wherever a related artist was played on one of those shows.
 */
export function connectionsGraph(
  self: { name: string },
  shows: { key: string; name: string; href: string; episodes: number }[],
  related: { id: number; name: string; slug: string; shared: number }[],
  links: { artist: number; show: string; episodes: number }[],
): VizData {
  const ep = (n: number) => `${n.toLocaleString("en-GB")} episode${n === 1 ? "" : "s"}`;
  const showIds = new Set(shows.map((s) => s.key));
  const artistIds = new Set(related.map((a) => a.id));
  return {
    kind: "graph", name: "Connections", x: [], tip: [], y: [],
    nodes: [
      { id: "self", name: self.name, href: "", kind: "self", weight: 0, detail: "" },
      ...shows.map((s) => ({ id: `s:${s.key}`, name: s.name, href: s.href, kind: "show" as const, weight: s.episodes, detail: `Show · played ${self.name} on ${ep(s.episodes)}` })),
      ...related.map((a) => ({ id: `a:${a.id}`, name: a.name, href: `/artists/${a.slug}/`, kind: "artist" as const, weight: a.shared, detail: `Artist · in ${ep(a.shared)} with ${self.name}` })),
    ],
    links: [
      ...shows.map((s) => ({ source: "self", target: `s:${s.key}`, weight: s.episodes })),
      ...related.map((a) => ({ source: "self", target: `a:${a.id}`, weight: a.shared })),
      ...links.filter((l) => artistIds.has(l.artist) && showIds.has(l.show)).map((l) => ({ source: `a:${l.artist}`, target: `s:${l.show}`, weight: l.episodes })),
    ],
  };
}

const UK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A UTC timestamp's date, weekday (0 = Monday) and hour in UK time, where NTS broadcasts from. */
export function ukTime(iso: string): { date: string; weekday: number; hour: number } {
  const p = Object.fromEntries(UK.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAYS.indexOf(p.weekday), hour: Number(p.hour) };
}

/** Episodes per day (UK dates) for a calendar heatmap. */
export function playCalendar(times: string[]): VizData {
  const days = new Map<string, number>();
  for (const t of times) { const d = ukTime(t).date; days.set(d, (days.get(d) ?? 0) + 1); }
  const cells = [...days].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    kind: "calendar", name: "Episodes", x: [], tip: [], y: [], cells,
    years: [...new Set(cells.map(([d]) => d.slice(0, 4)))],
    max: Math.max(1, ...cells.map(([, n]) => n)),
  };
}

/** Episodes by weekday and hour they started (UK time), for a weekly clock heatmap. */
export function playClock(times: string[]): VizData {
  const grid = WEEKDAYS.map(() => new Array<number>(24).fill(0));
  for (const t of times) { const u = ukTime(t); grid[u.weekday][u.hour]++; }
  return { kind: "clock", name: "Episodes", x: WEEKDAYS, tip: [], y: [], grid, max: Math.max(1, ...grid.flat()) };
}

/** Five bins for a heatmap scale (few → many): exact counts when small, otherwise even steps up to max. */
export function heatBins(max: number): [number, number][] {
  if (max <= 5) return Array.from({ length: max }, (_, i) => [i + 1, i + 1] as [number, number]);
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.max(1, Math.round(f * max)));
  const bins: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const lo = i === 0 ? 1 : edges[i] + 1;
    const hi = edges[i + 1];
    if (hi >= lo) bins.push([lo, hi]);
  }
  return bins;
}

/** The current top entries' ranks over the last few charts, for a bump chart. */
export function bumpChart(keys: readonly string[], entries: { name: string; href: string; ranks: (number | null)[] }[], label: (key: string) => string, tip: (key: string) => string): VizData {
  return {
    kind: "bump", name: "Rank", x: keys.map(label), tip: keys.map(tip), y: [],
    max: Math.max(10, entries.length), // places shown on the axis; lower ranks run along the bottom
    series: entries.map((e) => ({ name: e.name, y: e.ranks, color: "" })),
    hrefs: entries.map((e) => e.href),
  };
}
