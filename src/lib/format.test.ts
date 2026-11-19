import { describe, expect, it } from "vitest";
import { compareWindows, dateRange, periodBounds, periodDates, quarterKey, formatChange, isoWeekKey, isoWeekStart, periodHeading, periodLabel, rollingStartKey, weekYearsAgo } from "./format.ts";

describe("ISO weeks", () => {
  it("matches known ISO week numbers, including year boundaries", () => {
    expect(isoWeekKey(new Date("2026-11-18T12:00:00Z"))).toBe("2026-W47");
    expect(isoWeekKey(new Date("2021-01-03T12:00:00Z"))).toBe("2020-W53");
    expect(isoWeekKey(new Date("2024-12-30T12:00:00Z"))).toBe("2025-W01");
    expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
  });
  it("round-trips week start dates", () => {
    expect(isoWeekStart("2026-W47").toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(isoWeekStart("2020-W53").toISOString().slice(0, 10)).toBe("2020-12-28");
  });
  it("labels periods", () => {
    expect(periodLabel("week", "2026-W47")).toBe("Week 47 · 16–22 Nov 2026");
    expect(periodLabel("week", "2026-W49")).toBe("Week 49 · 30 Nov – 6 Dec 2026");
    expect(periodLabel("month", "2026-11")).toBe("November 2026");
    expect(periodLabel("rolling", "2026-W47")).toBe("4 weeks · 26 Oct – 22 Nov 2026");
    expect(periodLabel("rolling", "2026-W02")).toBe("4 weeks · 15 Dec 2025 – 11 Jan 2026");
  });
  it("builds chart page headings: name first, type and dates second", () => {
    expect(periodHeading("week", "2026-W47")).toEqual({ title: "Week 47", sub: "Weekly chart · 16–22 Nov 2026", dates: "16–22 Nov 2026" });
    expect(periodHeading("rolling", "2026-W47")).toEqual({ title: "4 weeks to 22 Nov", sub: "4-week chart · 26 Oct – 22 Nov 2026", dates: "26 Oct – 22 Nov 2026" });
    expect(periodHeading("month", "2026-11")).toMatchObject({ title: "November 2026", sub: "Monthly chart" });
    expect(periodHeading("year", "2026")).toMatchObject({ title: "2026", sub: "Yearly chart" });
  });
  it("finds the first week of a 4-week window", () => {
    expect(rollingStartKey("2026-W47")).toBe("2026-W44");
    expect(rollingStartKey("2026-W02")).toBe("2025-W51");
  });
});

describe("overview helpers", () => {
  it("compares an in-progress window with the same days of the previous one", () => {
    const w = compareWindows("2026-W47", new Date("2026-11-19T12:00:00Z"));
    expect(w.current).toEqual({ from: "2026-10-26T00:00:00.000Z", to: "2026-11-19T12:00:00.000Z" });
    expect(w.days).toBe(25);
    expect(w.previous).toEqual({ from: "2026-09-28T00:00:00.000Z", to: "2026-10-22T12:00:00.000Z" });
    expect(w.previousFull.to).toBe("2026-10-26T00:00:00.000Z");
  });
  it("uses whole windows once they're over", () => {
    const w = compareWindows("2026-W46", new Date("2026-12-01T00:00:00Z"));
    expect(w.days).toBe(28);
    expect(w.current.to).toBe("2026-11-16T00:00:00.000Z");
  });
  it("formats date ranges", () => {
    expect(dateRange(new Date("2026-10-26T00:00:00Z"), new Date("2026-11-18T09:00:00Z"))).toBe("26 Oct – 18 Nov 2026");
    expect(dateRange(new Date("2025-12-29T00:00:00Z"), new Date("2026-01-04T00:00:00Z"))).toBe("29 Dec 2025 – 4 Jan 2026");
    expect(dateRange(new Date("2026-11-16T00:00:00Z"), new Date("2026-11-18T09:00:00Z"))).toBe("16–18 Nov 2026");
  });
  it("labels chart dates the same way everywhere: in progress with the data date while running, full range once done", () => {
    const asOf = new Date("2026-11-18T09:00:00Z");
    expect(periodDates("rolling", "2026-W47", asOf)).toEqual({ text: "26 Oct – 22 Nov 2026 · in progress, up to 18 Nov", inProgress: true });
    expect(periodDates("week", "2026-W47", asOf)).toEqual({ text: "16–22 Nov 2026 · in progress, up to 18 Nov", inProgress: true });
    expect(periodDates("rolling", "2026-W46", asOf)).toEqual({ text: "19 Oct – 15 Nov 2026", inProgress: false });
    expect(periodDates("week", "2026-W46", asOf)).toEqual({ text: "9–15 Nov 2026", inProgress: false });
    expect(periodDates("month", "2026-11", asOf)).toEqual({ text: "1–30 Nov 2026 · in progress, up to 18 Nov", inProgress: true });
    expect(periodDates("month", "2026-10", asOf)).toEqual({ text: "", inProgress: false });
    expect(periodDates("year", "2026", asOf)).toEqual({ text: "1 Jan – 31 Dec 2026 · in progress, up to 18 Nov", inProgress: true });
  });
  it("formats changes as percentages or points", () => {
    expect(formatChange(112, 100, "pct")).toMatchObject({ text: "+12%", dir: "up" });
    expect(formatChange(90, 100, "pct")).toMatchObject({ text: "−10%", dir: "down" });
    expect(formatChange(98.1, 97.6, "pts")).toMatchObject({ text: "+0.5 pts", dir: "up" });
    expect(formatChange(5, 5, "pct")).toMatchObject({ text: "No change", dir: "same" });
    expect(formatChange(5, 0, "pct")).toBeNull();
  });
  it("finds the same week in earlier years", () => {
    expect(weekYearsAgo("2026-W47", 1)).toBe("2025-W47");
    expect(weekYearsAgo("2026-W47", 10)).toBe("2016-W47");
    expect(weekYearsAgo("2026-W53", 1)).toBe("2025-W52"); // 2025 has 52 ISO weeks
    expect(weekYearsAgo("2026-W53", 6)).toBe("2020-W53"); // 2020 has 53
  });
});

describe("quarters and in-progress titles", () => {
  it("names, keys and bounds quarters", () => {
    expect(quarterKey(new Date("2026-11-18T00:00:00Z"))).toBe("2026-Q4");
    expect(quarterKey(new Date("2026-03-31T23:59:59Z"))).toBe("2026-Q1");
    expect(periodLabel("quarter", "2026-Q4")).toBe("Q4 2026");
    expect(periodHeading("quarter", "2026-Q4")).toMatchObject({ title: "Q4 2026", sub: "Quarterly chart" });
    const b = periodBounds("quarter", "2026-Q4");
    expect([b.start.toISOString(), b.end.toISOString()]).toEqual(["2026-10-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  });
  it("labels quarter dates", () => {
    const asOf = new Date("2026-11-18T09:00:00Z");
    expect(periodDates("quarter", "2026-Q3", asOf)).toEqual({ text: "Jul – Sep 2026", inProgress: false });
    expect(periodDates("quarter", "2026-Q4", asOf)).toEqual({ text: "1 Oct – 31 Dec 2026 · in progress, up to 18 Nov", inProgress: true });
  });
  it("doesn't promise an end date for a running 4-week chart", () => {
    expect(periodHeading("rolling", "2026-W47", true).title).toBe("Last 4 weeks");
    expect(periodHeading("rolling", "2026-W46").title).toBe("4 weeks to 15 Nov");
  });
});
