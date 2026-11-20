import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { seasonKey } from "../src/lib/format.ts";
import { findThemeTunes, PERIOD_KEY_SQL, sortPeriodKeys, withMovement, type Ranked } from "./charts.ts";

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

describe("sortPeriodKeys", () => {
  it("puts seasons in time order, winter first", () => {
    expect(sortPeriodKeys(["2026-summer", "2025-autumn", "2026-winter", "2026-autumn", "2026-spring"]))
      .toEqual(["2025-autumn", "2026-winter", "2026-spring", "2026-summer", "2026-autumn"]);
  });
  it("leaves other keys in string order", () => {
    expect(sortPeriodKeys(["2026-W02", "2025-W52", "2026-W01"])).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
  });
  it("keys seasons the same in SQL as on the site, at every month's first and last moment", () => {
    const db = new DatabaseSync(":memory:");
    const key = db.prepare(`SELECT ${PERIOD_KEY_SQL.season} k FROM (SELECT ? broadcast_at)`);
    for (let m = 0; m < 12; m++) {
      for (const d of [new Date(Date.UTC(2025, m, 1)), new Date(Date.UTC(2025, m + 1, 1) - 1000)]) {
        expect((key.get(d.toISOString()) as { k: string }).k).toBe(seasonKey(d));
      }
    }
  });
  it("gives movement between seasons in time order", () => {
    const out = withMovement([r("2026-spring", 1, 1), r("2026-winter", 1, 2)]);
    expect(out.find((x) => x.periodKey === "2026-spring")).toMatchObject({ status: "up", prevRank: 2 });
  });
});

describe("findThemeTunes", () => {
  const ep = (show: string, first: number, last: number) => ({ show, first, last });
  it("finds a track that opens every episode", () => {
    const eps = [1, 2, 3, 4, 5].map((i) => ep("windmills", 99, i));
    expect(findThemeTunes(eps)).toEqual([{ show: "windmills", trackId: 99, episodes: 5, ofTotal: 5 }]);
  });
  it("counts closing tracks, and a track that both opens and closes once per episode", () => {
    const eps = [ep("s", 1, 7), ep("s", 2, 7), ep("s", 7, 7), ep("s", 3, 7), ep("s", 4, 5)];
    expect(findThemeTunes(eps)).toEqual([{ show: "s", trackId: 7, episodes: 4, ofTotal: 5 }]);
  });
  it("needs at least half the episodes and at least four of them", () => {
    expect(findThemeTunes([ep("s", 9, 1), ep("s", 9, 2), ep("s", 9, 3)])).toEqual([]); // only 3
    const eps = [...[1, 2, 3, 4].map((i) => ep("s", 9, i)), ...[5, 6, 7, 8, 10].map((i) => ep("s", i, i + 100))];
    expect(findThemeTunes(eps)).toEqual([]); // 4 of 9
  });
  it("keeps shows separate", () => {
    const eps = [...[1, 2, 3, 4].map((i) => ep("a", 9, i)), ...[1, 2, 3, 4].map((i) => ep("b", i, i))];
    expect(findThemeTunes(eps).map((t) => t.show)).toEqual(["a"]);
  });
});
