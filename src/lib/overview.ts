// Build-time data for the home page overview. Everything is about the latest 4-week chart window.
import { all, get } from "./db.ts";
import { compareWindows, formatChange, isoWeekKey, isoWeekStart, rollingStartKey, weekYearsAgo, type Change, type Window } from "./format.ts";
import { artistChart, artistsForTracks, periodKeys, trackChart, type ArtistRef } from "./queries.ts";
import { rankLine } from "./series.ts";

const IN = "e.track_count > 0 AND e.broadcast_at >= ? AND e.broadcast_at < ?";

/** When the data runs to: the latest broadcast with a tracklist. */
export function asOf(): Date {
  const r = get<{ last: string | null }>("SELECT max(broadcast_at) last FROM episodes WHERE track_count > 0");
  return r?.last ? new Date(r.last) : new Date();
}

/** True once nearly every past episode has had its tracklist fetched (the backfill is done). */
export function archiveComplete(): boolean {
  const r = get<{ share: number }>(
    "SELECT 1.0 * sum(tracklist_fetched_at IS NOT NULL) / count(*) share FROM episodes WHERE broadcast_at < ?",
    new Date().toISOString(),
  );
  return (r?.share ?? 0) >= 0.95;
}

function counts(w: Window) {
  const r = get<{ episodes: number; tracks: number; once: number }>(
    `WITH t AS (
       SELECT p.track_id, count(DISTINCT p.episode_alias) n
       FROM plays p JOIN episodes e ON e.alias = p.episode_alias WHERE ${IN} GROUP BY p.track_id)
     SELECT (SELECT count(*) FROM episodes e WHERE ${IN}) episodes, count(*) tracks, sum(n = 1) once FROM t`,
    w.from, w.to, w.from, w.to,
  )!;
  return { episodes: r.episodes, tracks: r.tracks, oncePct: r.tracks ? (100 * (r.once ?? 0)) / r.tracks : 0 };
}

export interface Stat { label: string; value: string; caption?: string; change: Change | null }

export function headlineStats(key: string, complete: boolean): Stat[] {
  const w = compareWindows(key, asOf());
  const cur = counts(w.current);
  const prev = counts(w.previous);
  const n = (v: number) => v.toLocaleString("en-GB");
  const stats: Stat[] = [
    { label: "Episodes", value: n(cur.episodes), change: formatChange(cur.episodes, prev.episodes, "pct") },
    { label: "Different tracks played", value: n(cur.tracks), change: formatChange(cur.tracks, prev.tracks, "pct") },
    {
      label: "Played only once",
      value: `${Math.round(cur.oncePct)}%`,
      caption: "of tracks were played on a single episode",
      change: formatChange(Math.round(cur.oncePct * 10) / 10, Math.round(prev.oncePct * 10) / 10, "pts"),
    },
  ];
  if (complete) {
    // First-ever plays are only meaningful once the whole archive is in.
    const r = get<{ cur: number; prev: number }>(
      `SELECT (SELECT count(*) FROM artist_firsts WHERE first_at >= ? AND first_at < ?) cur,
              (SELECT count(*) FROM artist_firsts WHERE first_at >= ? AND first_at < ?) prev`,
      w.current.from, w.current.to, w.previous.from, w.previous.to,
    )!;
    stats.push({ label: "Artists new to NTS", value: n(r.cur ?? 0), caption: "played for the first time ever", change: formatChange(r.cur ?? 0, r.prev ?? 0, "pct") });
  }
  return stats;
}

// ---------- spotlight, movers, on this day ----------

export interface Item {
  rank: number;
  title: string;
  href?: string;
  artists?: ArtistRef[];
  credit?: string;
  kind: "track" | "artist";
  status?: string;
  prevRank?: number | null;
  count?: string;
}

function weeksAtNumberOne(kind: "track" | "artist", id: number): number {
  return get<{ n: number }>(
    "SELECT count(*) n FROM chart_entries WHERE period_type = 'rolling' AND entity_type = ? AND entity_id = ? AND rank = 1",
    kind, id,
  )!.n;
}

function rollingHistory(kind: "track" | "artist", id: number, key: string) {
  const from = new Date(isoWeekStart(key).getTime() - 25 * 7 * 86_400_000);
  return rankLine(
    all<{ week: string; rank: number }>(
      `SELECT period_key week, rank FROM chart_entries
       WHERE period_type = 'rolling' AND entity_type = ? AND entity_id = ? AND period_key BETWEEN ? AND ? ORDER BY period_key`,
      kind, id, isoWeekKey(from), key,
    ),
  );
}

export function spotlight(key: string) {
  const t = trackChart("rolling", key, 1)[0];
  const a = artistChart("rolling", key, 1)[0];
  return {
    track: t && { ...t, weeksAtOne: weeksAtNumberOne("track", t.id), history: rollingHistory("track", t.id, key) },
    artist: a && { ...a, weeksAtOne: weeksAtNumberOne("artist", a.id), history: rollingHistory("artist", a.id, key) },
  };
}

function resolve(rows: { kind: "track" | "artist"; id: number; rank: number; prevRank: number | null; status: string; score: number }[]): Item[] {
  const trackIds = rows.filter((r) => r.kind === "track").map((r) => r.id);
  const credits = artistsForTracks(trackIds);
  const tracks = new Map(trackIds.length
    ? all<{ id: number; title: string; credit: string }>(
        `SELECT id, title_display title, artist_display credit FROM tracks WHERE id IN (${trackIds.map(() => "?").join(",")})`, ...trackIds,
      ).map((t) => [t.id, t])
    : []);
  const artistIds = rows.filter((r) => r.kind === "artist").map((r) => r.id);
  const artists = new Map(artistIds.length
    ? all<{ id: number; name: string; slug: string }>(
        `SELECT id, name, slug FROM artists WHERE id IN (${artistIds.map(() => "?").join(",")})`, ...artistIds,
      ).map((a) => [a.id, a])
    : []);
  return rows.map((r) => {
    const base = { rank: r.rank, kind: r.kind, status: r.status, prevRank: r.prevRank, count: `${r.score} eps` };
    if (r.kind === "track") {
      const t = tracks.get(r.id)!;
      return { ...base, title: t.title, artists: credits.get(r.id) ?? [], credit: t.credit };
    }
    const a = artists.get(r.id)!;
    return { ...base, title: a.name, href: `/artists/${a.slug}/` };
  });
}

/** Biggest climbers and highest new entries (first time ever; re-entries excluded) on the latest 4-week chart. */
export function movers(key: string, limit = 5) {
  const cols = "entity_type kind, entity_id id, rank, prev_rank prevRank, status, score";
  const climbers = all<Parameters<typeof resolve>[0][number]>(
    `SELECT ${cols} FROM chart_entries WHERE period_type = 'rolling' AND period_key = ? AND status = 'up'
     ORDER BY prev_rank - rank DESC, rank LIMIT ?`, key, limit,
  );
  const entries = all<Parameters<typeof resolve>[0][number]>(
    `SELECT ${cols} FROM chart_entries WHERE period_type = 'rolling' AND period_key = ? AND status = 'new'
     ORDER BY rank, entity_type DESC LIMIT ?`, key, limit,
  );
  return { climbers: resolve(climbers), entries: resolve(entries) };
}

/** The weekly #1s from the same week 1, 5 and 10 years ago (only years whose chart exists). */
export function onThisDay(weekKey: string) {
  const weeks = new Set(periodKeys("week"));
  return [1, 5, 10]
    .map((years) => ({ years, key: weekYearsAgo(weekKey, years) }))
    .filter((y) => weeks.has(y.key))
    .map((y) => ({ ...y, track: trackChart("week", y.key, 1)[0], artist: artistChart("week", y.key, 1)[0] }));
}

// ---------- genres ----------

function genreCounts(w: Window): { total: number; byGenre: Map<string, number> } {
  const total = get<{ n: number }>(
    `SELECT count(*) n FROM episodes e WHERE ${IN} AND e.genres_json IS NOT NULL AND e.genres_json != '[]'`, w.from, w.to,
  )!.n;
  const byGenre = new Map(all<{ g: string; n: number }>(
    `SELECT j.value g, count(DISTINCT e.alias) n FROM episodes e, json_each(e.genres_json) j WHERE ${IN} GROUP BY g`, w.from, w.to,
  ).map((r) => [r.g, r.n]));
  return { total, byGenre };
}

/** Top genres by share of episodes in the window, with the share in the previous 4 weeks. */
export function genreMix(key: string, limit = 10) {
  const w = compareWindows(key, asOf());
  const cur = genreCounts(w.current);
  const prev = genreCounts(w.previousFull);
  const pct = (n: number, total: number) => (total ? (100 * n) / total : 0);
  return [...cur.byGenre]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre, n]) => ({ genre, share: pct(n, cur.total), prevShare: pct(prev.byGenre.get(genre) ?? 0, prev.total) }));
}

/**
 * Week-by-week share of episodes for the top genres across the 4-week window ending in `key`
 * (the same window as the rest of the home page). The current week counts its episodes so far.
 */
export function genreTrends(key: string, genres = 6) {
  const weeks: string[] = [];
  for (let d = isoWeekStart(rollingStartKey(key)); weeks.length < 4; d = new Date(d.getTime() + 7 * 86_400_000)) weeks.push(isoWeekKey(d));
  const from = isoWeekStart(weeks[0]).toISOString();
  const to = new Date(isoWeekStart(key).getTime() + 7 * 86_400_000).toISOString();
  const WEEK = "strftime('%G-W%V', e.broadcast_at)";
  const totals = new Map(all<{ w: string; n: number }>(
    `SELECT ${WEEK} w, count(*) n FROM episodes e
     WHERE ${IN} AND e.genres_json IS NOT NULL AND e.genres_json != '[]' GROUP BY w`, from, to,
  ).map((r) => [r.w, r.n]));
  const rows = all<{ w: string; g: string; n: number }>(
    `SELECT ${WEEK} w, j.value g, count(DISTINCT e.alias) n
     FROM episodes e, json_each(e.genres_json) j WHERE ${IN} GROUP BY w, g`, from, to,
  );
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.g, (sums.get(r.g) ?? 0) + r.n);
  const top = [...sums].sort((a, b) => b[1] - a[1]).slice(0, genres).map(([g]) => g);
  const series = top.map((g) => ({
    genre: g,
    weeks,
    shares: weeks.map((w) => {
      const n = rows.find((r) => r.w === w && r.g === g)?.n ?? 0;
      const t = totals.get(w) ?? 0;
      return t ? Math.round((1000 * n) / t) / 10 : null;
    }),
  }));
  const peak = Math.max(0, ...series.flatMap((x) => x.shares.filter((v): v is number => v != null)));
  // A shared scale in whole tens, so the small multiples compare directly.
  return { series, max: Math.max(10, Math.ceil(peak / 10) * 10) };
}
