// Interactive charts. Only the ECharts pieces we use are bundled; each chart initialises
// when it scrolls into view and re-themes when the OS colour scheme changes.
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { formatViz } from "../lib/series.ts";

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, DataZoomComponent, SVGRenderer]);

export interface VizData {
  // bars: vertical counts over time · rank: chart position over time (inverted)
  // hbar: horizontal % bars by category · share: % line over time (small multiples share `max`)
  kind: "bars" | "rank" | "hbar" | "share";
  name: string;            // series name, e.g. "Episodes"
  x: string[];             // short axis labels (categories for hbar)
  tip: string[];           // long labels for the tooltip
  y: (number | null)[];
  max?: number;            // rank: chart size · share: shared y maximum (%)
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ZOOM_AFTER = 60;    // points before a zoom slider appears
const ZOOM_WINDOW = 36;   // points visible by default when zoomable

function option(d: VizData): echarts.EChartsCoreOption {
  const t = {
    ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"),
    surface: css("--surface"), series: css("--series-1"), wash: css("--series-1-wash"), font: css("--font"),
  };
  const horizontal = d.kind === "hbar";
  const pct = d.kind === "hbar" || d.kind === "share";
  const zoom = !horizontal && d.x.length > ZOOM_AFTER;
  const start = zoom ? Math.max(0, 100 - (ZOOM_WINDOW / d.x.length) * 100) : 0;
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
            symbol: "circle", symbolSize: 9, showSymbol: d.x.length <= ZOOM_AFTER,
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
