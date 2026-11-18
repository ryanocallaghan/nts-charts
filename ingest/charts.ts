// Pure chart logic (no DB) — unit tested in charts.test.ts.

export type PeriodType = "week" | "month" | "year" | "all";
export type Status = "up" | "down" | "same" | "new" | "reentry";

export const PERIOD_TYPES: PeriodType[] = ["week", "month", "year", "all"];
// SQL expression giving an episode's period key (episodes alias: broadcast_at).
export const PERIOD_KEY_SQL: Record<PeriodType, string> = {
  week: "strftime('%G-W%V', broadcast_at)", // ISO week, e.g. 2026-W47
  month: "strftime('%Y-%m', broadcast_at)",
  year: "strftime('%Y', broadcast_at)",
  all: "'all'", // one all-time chart
};

export interface Ranked {
  periodKey: string;
  entityId: number;
  rank: number;
  score: number;
  shows: number;
}

export interface Charted extends Ranked {
  prevRank: number | null;
  status: Status;
  periodsOnChart: number;
}

/**
 * Add movement vs the previous period. `rows` must cover every period of one type
 * (any order); "previous" means the preceding period key that has a chart.
 */
export function withMovement(rows: Ranked[]): Charted[] {
  const byPeriod = new Map<string, Ranked[]>();
  for (const r of rows) {
    const list = byPeriod.get(r.periodKey) ?? [];
    list.push(r);
    byPeriod.set(r.periodKey, list);
  }
  const periods = [...byPeriod.keys()].sort();
  const timesCharted = new Map<number, number>();
  let prev = new Map<number, number>(); // entityId -> rank in previous period
  const out: Charted[] = [];

  for (const key of periods) {
    const current = new Map<number, number>();
    for (const r of byPeriod.get(key)!.sort((a, b) => a.rank - b.rank)) {
      const prevRank = prev.get(r.entityId) ?? null;
      const seen = timesCharted.get(r.entityId) ?? 0;
      const status: Status =
        prevRank == null ? (seen > 0 ? "reentry" : "new") : prevRank > r.rank ? "up" : prevRank < r.rank ? "down" : "same";
      timesCharted.set(r.entityId, seen + 1);
      current.set(r.entityId, r.rank);
      out.push({ ...r, prevRank, status, periodsOnChart: seen + 1 });
    }
    prev = current;
  }
  return out;
}
