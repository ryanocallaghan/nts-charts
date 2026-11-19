import { describe, expect, it } from "vitest";
import { sparklinePath } from "./series.ts";

describe("sparklinePath", () => {
  it("puts rank 1 at the top and the chart size at the bottom", () => {
    const { d, last } = sparklinePath([50, 1], 100, 40, 50, 0);
    expect(d).toBe("M0 40L100 0");
    expect(last).toEqual({ x: 100, y: 0 });
  });
  it("breaks the line where the item was off the chart", () => {
    expect(sparklinePath([10, null, 5, 1], 30, 40, 50, 0).d).toMatch(/^M0 [\d.]+M20 [\d.]+L30 0$/);
  });
  it("centres a single point", () => {
    expect(sparklinePath([1], 100, 40, 50, 4)).toEqual({ d: "M50 4", last: { x: 50, y: 4 } });
  });
});

import { bumpChart, heatBins, playCalendar, playClock, ukTime } from "./series.ts";

describe("ukTime", () => {
  it("converts UTC to UK time, including summer time", () => {
    expect(ukTime("2026-01-05T23:30:00.000Z")).toEqual({ date: "2026-01-05", weekday: 0, hour: 23 }); // GMT, a Monday
    expect(ukTime("2026-07-05T23:30:00.000Z")).toEqual({ date: "2026-07-06", weekday: 0, hour: 0 });  // BST: already Monday
  });
});

describe("play patterns", () => {
  const times = ["2025-03-03T09:00:00.000Z", "2025-03-03T21:00:00.000Z", "2026-01-06T09:00:00.000Z"];
  it("counts episodes per UK day, with the years they span", () => {
    const c = playCalendar(times);
    expect(c.cells).toEqual([["2025-03-03", 2], ["2026-01-06", 1]]);
    expect(c.years).toEqual(["2025", "2026"]);
    expect(c.max).toBe(2);
  });
  it("counts episodes by weekday and starting hour", () => {
    const g = playClock(times).grid!;
    expect(g[0][9]).toBe(1);  // Monday 09:00
    expect(g[0][21]).toBe(1); // Monday 21:00
    expect(g[1][9]).toBe(1);  // Tuesday 09:00
    expect(g.flat().reduce((a, b) => a + b)).toBe(3);
  });
});

describe("heatBins", () => {
  it("uses exact counts when the maximum is small", () => {
    expect(heatBins(3)).toEqual([[1, 1], [2, 2], [3, 3]]);
  });
  it("splits larger ranges into five even steps that cover 1 to max", () => {
    const bins = heatBins(100);
    expect(bins).toHaveLength(5);
    expect(bins[0][0]).toBe(1);
    expect(bins.at(-1)![1]).toBe(100);
    for (let i = 1; i < bins.length; i++) expect(bins[i][0]).toBe(bins[i - 1][1] + 1);
  });
});

describe("bumpChart", () => {
  it("keeps each entry's ranks and link, and shows at least the top 10", () => {
    const b = bumpChart(["2026-W45", "2026-W46"], [{ name: "A", href: "/a/", ranks: [12, 1] }], (k) => k, (k) => k);
    expect(b.series).toEqual([{ name: "A", y: [12, 1], color: "" }]);
    expect(b.hrefs).toEqual(["/a/"]);
    expect(b.max).toBe(10);
  });
});
