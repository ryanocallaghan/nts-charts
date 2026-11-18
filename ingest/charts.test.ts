import { describe, expect, it } from "vitest";
import { withMovement, type Ranked } from "./charts.ts";

const r = (periodKey: string, entityId: number, rank: number): Ranked => ({ periodKey, entityId, rank, score: 10 - rank, shows: 1 });

describe("withMovement", () => {
  const out = withMovement([
    // deliberately out of order
    r("2026-W02", 2, 1), r("2026-W02", 1, 2), r("2026-W02", 4, 3),
    r("2026-W01", 1, 1), r("2026-W01", 2, 2), r("2026-W01", 3, 3),
    r("2026-W03", 3, 1), r("2026-W03", 2, 2), r("2026-W03", 4, 3),
  ]);
  const get = (p: string, id: number) => out.find((x) => x.periodKey === p && x.entityId === id)!;

  it("marks everything in the first period as new", () => {
    expect([1, 2, 3].map((id) => get("2026-W01", id).status)).toEqual(["new", "new", "new"]);
  });
  it("computes up / down from the previous period", () => {
    expect(get("2026-W02", 2)).toMatchObject({ status: "up", prevRank: 2, periodsOnChart: 2 });
    expect(get("2026-W02", 1)).toMatchObject({ status: "down", prevRank: 1 });
  });
  it("distinguishes re-entries from new entries", () => {
    expect(get("2026-W02", 4).status).toBe("new");
    expect(get("2026-W03", 3)).toMatchObject({ status: "reentry", prevRank: null, periodsOnChart: 2 });
  });
  it("marks unchanged positions as same", () => {
    expect(get("2026-W03", 2)).toMatchObject({ status: "down", prevRank: 1 });
    expect(get("2026-W03", 4)).toMatchObject({ status: "same", prevRank: 3 });
  });
});
