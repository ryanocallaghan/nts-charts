// Interactive charts. Only the ECharts pieces we use are bundled; each chart initialises
// when it scrolls into view and re-themes when the OS colour scheme changes.
import * as echarts from "echarts/core";
import { BarChart, GraphChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { formatViz } from "../lib/series.ts";

echarts.use([BarChart, GraphChart, LineChart, GridComponent, TooltipComponent, DataZoomComponent, SVGRenderer]);

export interface VizData {
  // bars: vertical counts over time · rank: chart position over time (inverted)
  // hbar: horizontal % bars by category · share: % line over time (small multiples share `max`)
  // stack: several % series stacked over time (`series`, bottom first; `y` unused; `max` the axis top)
  // graph: a network (`nodes`, `links`); x, tip and y unused
  kind: "bars" | "rank" | "hbar" | "share" | "stack" | "graph";
  name: string;            // series name, e.g. "Episodes"
  x: string[];             // short axis labels (categories for hbar)
  tip: string[];           // long labels for the tooltip
  y: (number | null)[];
  max?: number;            // rank: chart size · share: shared y maximum (%)
  series?: { name: string; y: (number | null)[]; color: string }[]; // stack: color is a CSS variable, e.g. "--cat-1"
  nodes?: { id: string; name: string; href: string; kind: "self" | "artist" | "show"; weight: number; detail: string }[];
  links?: { source: string; target: string; weight: number }[];
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ZOOM_AFTER = 60;    // points before a zoom slider appears
const ZOOM_WINDOW = 36;   // points visible by default when zoomable

/** Stacked shares over time: filled bands split by a thin surface-coloured gap, a crosshair tooltip
 *  listing every band (top band first), and a % axis. The legend is HTML beside the chart. */
function stackOption(d: VizData, t: Record<string, string>): echarts.EChartsCoreOption {
  const series = d.series ?? [];
  const axisLabel = { color: t.muted, fontSize: 12 };
  return {
    animationDuration: 300,
    textStyle: { fontFamily: t.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis", confine: true, backgroundColor: t.surface, borderColor: t.grid, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 13 },
      axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } },
      formatter: (params: unknown) => {
        const i = (params as { dataIndex: number }[])[0].dataIndex;
        const rows = [...series].reverse().map((s) =>
          `<div style="display:flex;gap:12px;justify-content:space-between"><span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${css(s.color)};vertical-align:-1px;margin-right:6px"></span>${esc(s.name)}</span><span style="font-weight:600">${esc(formatViz("share", s.y[i]))}</span></div>`,
        ).join("");
        return `<div style="color:${t.ink2};margin-bottom:4px">${esc(d.tip[i])}</div>${rows}`;
      },
    },
    xAxis: {
      type: "category", data: d.x, boundaryGap: false,
      axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { ...axisLabel, hideOverlap: true },
    },
    yAxis: {
      type: "value", min: 0, max: d.max ?? 100,
      splitLine: { show: false }, axisLabel: { ...axisLabel, formatter: (v: number) => `${v}%` },
    },
    series: series.map((s) => ({
      type: "line", name: s.name, data: s.y, stack: "all", symbol: "none", smooth: false,
      lineStyle: { width: 1.5, color: t.surface },
      areaStyle: { color: css(s.color), opacity: 1 },
      emphasis: { focus: "series" },
    })),
  };
}

/** An artist's connections: shows (orange) and related artists (blue) around them, sized by weight,
 *  linked where they share episodes. Hover for details; click to open the page. */
function graphOption(d: VizData, t: Record<string, string>): echarts.EChartsCoreOption {
  const color = { self: css("--series-1"), artist: css("--cat-1"), show: css("--cat-2") };
  const max = Math.max(1, ...(d.nodes ?? []).filter((n) => n.kind !== "self").map((n) => n.weight));
  return {
    animationDuration: 300,
    textStyle: { fontFamily: t.font },
    tooltip: {
      confine: true, backgroundColor: t.surface, borderColor: t.grid, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 13 },
      formatter: (p: unknown) => {
        const n = (p as { dataType: string; data: { name: string; detail?: string } });
        return n.dataType === "node" ? `<div style="font-weight:600">${esc(n.data.name)}</div><div style="color:${t.ink2}">${esc(n.data.detail ?? "")}</div>` : "";
      },
    },
    series: [{
      type: "graph", layout: "force", roam: false, draggable: true,
      left: 16, right: 130, top: 16, bottom: 16, // room for labels, which sit to the right of each node
      force: { repulsion: 600, edgeLength: [90, 170], gravity: 0.05, layoutAnimation: false },
      labelLayout: { hideOverlap: true },
      label: { show: true, position: "right", color: t.ink2, fontSize: 12, width: 140, overflow: "truncate" },
      emphasis: { focus: "adjacency", label: { color: t.ink } },
      lineStyle: { color: t.axis, opacity: 0.6, curveness: 0.1 },
      data: (d.nodes ?? []).map((n) => ({
        id: n.id, name: n.name, href: n.href, detail: n.detail,
        symbolSize: n.kind === "self" ? 26 : 10 + 14 * Math.sqrt(n.weight / max),
        itemStyle: { color: color[n.kind], borderColor: t.surface, borderWidth: 2 },
        label: n.kind === "self" ? { fontWeight: 600, color: t.ink, fontSize: 13 } : undefined,
      })),
      links: (d.links ?? []).map((l) => ({ source: l.source, target: l.target, lineStyle: { width: 1 + Math.min(3, l.weight / 10) } })),
    }],
  };
}

function option(d: VizData): echarts.EChartsCoreOption {
  const t = {
    ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"),
    surface: css("--surface"), series: css("--series-1"), wash: css("--series-1-wash"), font: css("--font"),
  };
  if (d.kind === "stack") return stackOption(d, t);
  if (d.kind === "graph") return graphOption(d, t);
  const horizontal = d.kind === "hbar";
  const pct = d.kind === "hbar" || d.kind === "share";
  const zoom = !horizontal && d.x.length > ZOOM_AFTER;
  // Open on the latest points, unless it's a rank history with only a few weeks on the chart, spread
  // out: then the whole run fits better than a window that may hold one point.
  const sparse = d.kind === "rank" && d.y.filter((v) => v != null).length <= 20;
  const start = zoom && !sparse ? Math.max(0, 100 - (ZOOM_WINDOW / d.x.length) * 100) : 0;
  const axisLabel = { color: t.muted, fontSize: 12 };
  const categoryAxis = {
    type: "category" as const,
    data: d.x,
    boundaryGap: d.kind === "bars" || horizontal,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { ...axisLabel, hideOverlap: !horizontal, color: horizontal ? t.ink2 : t.muted },
  };
  const valueAxis =
    d.kind === "rank"
      ? {
          type: "value" as const, inverse: true, min: 1, max: d.max ?? 50,
          splitLine: { lineStyle: { color: t.grid } },
          axisLabel: { ...axisLabel, formatter: (v: number) => `#${v}` },
        }
      : {
          type: "value" as const, min: 0, max: d.kind === "share" ? d.max : undefined, minInterval: pct ? undefined : 1,
          interval: d.kind === "share" ? ((d.max ?? 10) <= 30 ? 10 : 20) : undefined,
          splitLine: { lineStyle: { color: t.grid } },
          axisLabel: { ...axisLabel, formatter: pct ? (v: number) => `${v}%` : undefined },
        };

  return {
    animationDuration: 300,
    textStyle: { fontFamily: t.font },
    grid: { left: 4, right: 12, top: 12, bottom: zoom ? 52 : 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.grid,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 13 },
      axisPointer:
        d.kind === "bars" || horizontal
          ? { type: "shadow", shadowStyle: { color: t.wash } }
          : { type: "line", lineStyle: { color: t.axis, width: 1 } },
      formatter: (params: unknown) => {
        const i = (params as { dataIndex: number }[])[0].dataIndex;
        const value = formatViz(d.kind, d.y[i]);
        // Value leads; series keyed by a short line, not a box.
        return `<div style="font-weight:600;font-size:15px">${esc(value)}</div>
          <div style="color:${t.ink2}"><span style="display:inline-block;width:12px;height:2px;background:${t.series};vertical-align:middle;margin-right:6px"></span>${esc(d.name)} · ${esc(d.tip[i])}</div>`;
      },
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    dataZoom: zoom
      ? [
          { type: "inside", start, end: 100 },
          {
            type: "slider", start, end: 100, height: 22, bottom: 8,
            borderColor: t.grid, fillerColor: t.wash, backgroundColor: "transparent",
            handleStyle: { color: t.surface, borderColor: t.axis },
            moveHandleStyle: { color: t.axis },
            textStyle: { color: t.muted },
            dataBackground: { lineStyle: { color: t.axis }, areaStyle: { color: t.wash } },
            selectedDataBackground: { lineStyle: { color: t.series }, areaStyle: { color: t.wash } },
          },
        ]
      : [],
    series: [
      d.kind === "bars" || horizontal
        ? {
            type: "bar", name: d.name, data: d.y, barMaxWidth: horizontal ? 18 : 24,
            // Rounded data end, square at the baseline.
            itemStyle: { color: t.series, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
            emphasis: { itemStyle: { opacity: 0.85 } },
          }
        : {
            type: "line", name: d.name, data: d.y, connectNulls: false,
            // Long series hide their dots, except a point with gaps on both sides, which would
            // otherwise draw nothing (e.g. a single week on the chart).
            symbol: "circle", showSymbol: true, showAllSymbol: true,
            symbolSize: (_: unknown, p: { dataIndex: number }) =>
              d.x.length <= ZOOM_AFTER || (d.y[p.dataIndex - 1] == null && d.y[p.dataIndex + 1] == null) ? 9 : 0,
            lineStyle: { width: 2, color: t.series, cap: "round", join: "round" },
            itemStyle: { color: t.series, borderColor: t.surface, borderWidth: 2 },
            areaStyle: undefined,
          },
    ],
  };
}

const mounted: { chart: echarts.ECharts; data: VizData }[] = [];

function mount(el: HTMLElement) {
  const data = JSON.parse(el.dataset.viz!) as VizData;
  const chart = echarts.init(el, undefined, { renderer: "svg" });
  chart.setOption(option(data));
  if (data.kind === "graph") chart.on("click", (p) => { const href = (p.data as { href?: string })?.href; if (href) location.href = href; });
  new ResizeObserver(() => chart.resize()).observe(el);
  mounted.push({ chart, data });
}

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      mount(e.target as HTMLElement);
    }
  },
  { rootMargin: "200px" },
);
/** Lazily mount every [data-viz] chart under root (call again after inserting charts). */
export function observeViz(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-viz]:not([data-viz-seen])").forEach((el) => {
    el.dataset.vizSeen = "";
    io.observe(el);
  });
}
observeViz();

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  for (const m of mounted) m.chart.setOption(option(m.data), true);
});
