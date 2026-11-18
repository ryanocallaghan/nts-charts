import { describe, expect, it } from "vitest";
import { isoWeekKey, isoWeekStart, periodLabel } from "./format.ts";

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
  });
});
