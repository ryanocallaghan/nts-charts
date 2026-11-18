// Interactive charts. Only the ECharts pieces we use are bundled; each chart initialises
// when it scrolls into view and re-themes when the OS colour scheme changes.
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, DataZoomComponent, SVGRenderer]);

export interface VizData {
  kind: "bars" | "rank";
  name: string;            // series name, e.g. "Episodes"
  x: string[];             // short axis labels
  tip: string[];           // long labels for the tooltip
  y: (number | null)[];
  max?: number;            // rank charts: chart size
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
  const zoom = d.x.length > ZOOM_AFTER;
  const start = zoom ? Math.max(0, 100 - (ZOOM_WINDOW / d.x.length) * 100) : 0;
  const axisLabel = { color: t.muted, fontSize: 12 };

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
        d.kind === "bars"
          ? { type: "shadow", shadowStyle: { color: t.wash } }
          : { type: "line", lineStyle: { color: t.axis, width: 1 } },
      formatter: (params: unknown) => {
        const i = (params as { dataIndex: number }[])[0].dataIndex;
        const v = d.y[i];
        const value = v == null ? "Not charted" : d.kind === "rank" ? `#${v}` : v.toLocaleString("en-GB");
        // Value leads; series keyed by a short line, not a box.
        return `<div style="font-weight:600;font-size:15px">${esc(value)}</div>
          <div style="color:${t.ink2}"><span style="display:inline-block;width:12px;height:2px;background:${t.series};vertical-align:middle;margin-right:6px"></span>${esc(d.name)} · ${esc(d.tip[i])}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: d.x,
      boundaryGap: d.kind === "bars",
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { ...axisLabel, hideOverlap: true },
    },
    yAxis:
      d.kind === "rank"
        ? {
            type: "value", inverse: true, min: 1, max: d.max ?? 50,
            splitLine: { lineStyle: { color: t.grid } },
            axisLabel: { ...axisLabel, formatter: (v: number) => `#${v}` },
          }
        : { type: "value", minInterval: 1, splitLine: { lineStyle: { color: t.grid } }, axisLabel },
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
      d.kind === "bars"
        ? {
            type: "bar", name: d.name, data: d.y, barMaxWidth: 24,
            itemStyle: { color: t.series, borderRadius: [4, 4, 0, 0] },
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
document.querySelectorAll<HTMLElement>("[data-viz]").forEach((el) => io.observe(el));

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  for (const m of mounted) m.chart.setOption(option(m.data), true);
});
