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
