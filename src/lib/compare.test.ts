import { describe, expect, it } from "vitest";
import { compareCharts } from "./compare.ts";
import { dayRange, parseRange, rangeBefore, rangeName, rangeYearsBefore, RANGE_MAX_DAYS } from "./ranges.ts";

const e = (id: number, rank: number) => ({ id, rank });

describe("compareCharts", () => {
  const first = [e(1, 1), e(2, 2), e(3, 3), e(4, 4), e(5, 5)];
  const second = [e(5, 1), e(3, 2), e(9, 3), e(1, 4), e(2, 5)];
  const c = compareCharts(first, second);
  it("counts what's in both", () => expect(c.both).toBe(4));
  it("lists the biggest rises and falls first", () => {
    expect(c.rose.map((m) => [m.entry.id, m.from, m.to])).toEqual([[5, 5, 1], [3, 3, 2]]);
    expect(c.fell.map((m) => [m.entry.id, m.from, m.to])).toEqual([[1, 1, 4], [2, 2, 5]]);
  });
  it("lists arrivals in the second chart's order and departures in the first's", () => {
    expect(c.arrived.map((x) => x.id)).toEqual([9]);
    expect(c.left.map((x) => x.id)).toEqual([4]);
  });
});

describe("date ranges", () => {
  const bounds = { first: new Date("2011-01-01"), last: new Date("2026-11-18") };
  it("includes both days", () => {
    const r = parseRange("2019-06-01", "2019-08-31", bounds);
    expect(r).toMatchObject({ days: 92, end: new Date("2019-09-01") });
  });
  it("pulls dates in to the charts' first and latest days", () => {
    expect(parseRange("2005-01-01", "2011-01-31", bounds)).toMatchObject({ start: new Date("2011-01-01"), days: 31 });
    expect(parseRange("2026-11-01", "2027-01-01", bounds)).toMatchObject({ last: new Date("2026-11-18"), days: 18 });
  });
  it("explains what's wrong", () => {
    expect(parseRange("2019-02-30", "2019-03-01", bounds)).toEqual({ problem: "Dates need to be real days." });
    expect(parseRange("2019-03-01", "2019-02-01", bounds)).toEqual({ problem: "The start date is after the end date." });
    expect(parseRange("2027-01-01", "2027-02-01", bounds)).toMatchObject({ problem: expect.stringContaining("18 Nov 2026") });
    expect(parseRange("2015-01-01", "2024-01-01", bounds)).toEqual({ problem: "That’s more than 3 years." });
    expect(parseRange("2020-01-01", new Date(Date.UTC(2020, 0, RANGE_MAX_DAYS)).toISOString().slice(0, 10), bounds)).toMatchObject({ days: RANGE_MAX_DAYS });
  });
  it("finds the days before and the same days a year earlier", () => {
    const r = dayRange(new Date("2019-06-01"), new Date("2019-08-31"));
    expect(rangeBefore(r, bounds.first)).toMatchObject({ start: new Date("2019-03-01"), last: new Date("2019-05-31"), days: 92 });
    expect(rangeYearsBefore(r, 1, bounds.first)).toMatchObject({ start: new Date("2018-06-01"), last: new Date("2018-08-31") });
    expect(rangeBefore(dayRange(new Date("2011-01-05"), new Date("2011-01-31")), bounds.first)).toBeNull();
  });
  it("names whole years, seasons and months", () => {
    const r = (a: string, b: string) => rangeName(dayRange(new Date(a), new Date(b)));
    expect(r("2019-01-01", "2019-12-31")).toBe("2019");
    expect(r("2019-06-01", "2019-08-31")).toBe("Summer 2019");
    expect(r("2018-12-01", "2019-02-28")).toBe("Winter 2018/19");
    expect(r("2019-06-01", "2019-06-30")).toBe("June 2019");
    expect(r("2019-06-01", "2019-08-30")).toBe("1 Jun – 30 Aug 2019");
  });
});
