// Two charts side by side (/charts/compare/): what's in both, what rose and fell between them, what
// arrived in the second and what left after the first. Pure; unit tested in compare.test.ts.

export interface RankedEntry { id: number; rank: number }
export interface Move<T> { entry: T; from: number; to: number }

export function compareCharts<T extends RankedEntry>(first: readonly T[], second: readonly T[]) {
  const before = new Map(first.map((e) => [e.id, e.rank]));
  const after = new Set(second.map((e) => e.id));
  const both: Move<T>[] = second.filter((e) => before.has(e.id)).map((e) => ({ entry: e, from: before.get(e.id)!, to: e.rank }));
  return {
    both: both.length,
    // Biggest moves first; equal moves, the higher place first.
    rose: both.filter((m) => m.to < m.from).sort((a, b) => b.from - b.to - (a.from - a.to) || a.to - b.to),
    fell: both.filter((m) => m.to > m.from).sort((a, b) => b.to - b.from - (a.to - a.from) || a.to - b.to),
    arrived: second.filter((e) => !before.has(e.id)),
    left: first.filter((e) => !after.has(e.id)),
  };
}
