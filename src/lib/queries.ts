import { all, get } from "./db.ts";
import { rollingStartKey, type PeriodType } from "./format.ts";

// Artists get their own page only above this activity (keeps the site under hosting file limits).
const ARTIST_MIN_EPISODES = Number(process.env.ARTIST_MIN_EPISODES ?? 3);
const ARTIST_MIN_SHOWS = Number(process.env.ARTIST_MIN_SHOWS ?? 2);
// ...and at most this many (the most-played first). Cloudflare Pages allows 20,000 files per deploy;
// shows, charts and the data/search shards take roughly another 5,500. Every other artist gets a
// page rendered in the browser from a data shard (see artists/404.astro).
const ARTIST_PAGE_LIMIT = Number(process.env.ARTIST_PAGE_LIMIT ?? 12000);

// Shared FROM clause: an artist's plays.
const ARTIST_PLAYS = `track_artists ta
  JOIN plays p ON p.track_id = ta.track_id
  JOIN episodes e ON e.alias = p.episode_alias`;

let pageArtists: Map<number, { slug: string; episodes: number }> | undefined;
function loadPageArtists() {
  pageArtists ??= new Map(
    all<{ id: number; slug: string; episodes: number }>(
      `SELECT a.id, a.slug, count(DISTINCT p.episode_alias) episodes, count(DISTINCT e.show_alias) shows
       FROM ${ARTIST_PLAYS} JOIN artists a ON a.id = ta.artist_id
       GROUP BY a.id
       HAVING (episodes >= ? AND shows >= ?)
           OR a.id IN (SELECT entity_id FROM chart_entries WHERE entity_type = 'artist')
       ORDER BY episodes DESC, shows DESC, a.id
       LIMIT ?`,
      ARTIST_MIN_EPISODES, ARTIST_MIN_SHOWS, ARTIST_PAGE_LIMIT,
    ).map((r) => [r.id, { slug: r.slug, episodes: r.episodes }]),
  );
  return pageArtists;
}
let pageSlugs: Map<number, string> | undefined;
/** id -> slug for artists that get a page. */
export function artistsWithPages(): Map<number, string> {
  pageSlugs ??= new Map([...loadPageArtists()].map(([id, a]) => [id, a.slug]));
  return pageSlugs;
}

export interface ArtistRef { id: number; name: string; slug: string | null }

/** Credited artists per track, in credit order. */
function artistsForTracks(trackIds: number[]): Map<number, ArtistRef[]> {
  const out = new Map<number, ArtistRef[]>();
  if (!trackIds.length) return out;
  const rows = all<{ track_id: number; id: number; name: string; slug: string }>(
    `SELECT ta.track_id, a.id, a.name, a.slug FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
     WHERE ta.track_id IN (${trackIds.map(() => "?").join(",")}) ORDER BY ta.rowid`,
    ...trackIds,
  );
  for (const r of rows) {
    const list = out.get(r.track_id) ?? [];
    list.push({ id: r.id, name: r.name, slug: r.slug });
    out.set(r.track_id, list);
  }
  return out;
}

// ---------- charts ----------

export function periodKeys(type: PeriodType): string[] {
  return all<{ k: string }>("SELECT DISTINCT period_key k FROM chart_entries WHERE period_type = ? ORDER BY k", type).map((r) => r.k);
}

export interface Movement { rank: number; prevRank: number | null; status: string; periodsOnChart: number; score: number; shows: number }
export interface TrackEntry extends Movement { id: number; title: string; artistDisplay: string; artists: ArtistRef[] }
export interface ArtistEntry extends Movement { id: number; name: string; slug: string | null }

const MOVEMENT = `c.rank, c.prev_rank AS prevRank, c.status, c.periods_on_chart AS periodsOnChart, c.score, c.shows_count AS shows`;

export function trackChart(type: PeriodType, key: string, limit = 50): TrackEntry[] {
  const rows = all<Omit<TrackEntry, "artists">>(
    `SELECT ${MOVEMENT}, t.id, t.title_display AS title, t.artist_display AS artistDisplay
     FROM chart_entries c JOIN tracks t ON t.id = c.entity_id
     WHERE c.period_type = ? AND c.period_key = ? AND c.entity_type = 'track' AND c.rank <= ? ORDER BY c.rank`,
    type, key, limit,
  );
  const artists = artistsForTracks(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, artists: artists.get(r.id) ?? [] }));
}

export function artistChart(type: PeriodType, key: string, limit = 50): ArtistEntry[] {
  return all<ArtistEntry>(
    `SELECT ${MOVEMENT}, a.id, a.name, a.slug
     FROM chart_entries c JOIN artists a ON a.id = c.entity_id
     WHERE c.period_type = ? AND c.period_key = ? AND c.entity_type = 'artist' AND c.rank <= ? ORDER BY c.rank`,
    type, key, limit,
  );
}

// ---------- site-wide ----------

export function siteStats() {
  return get<{ shows: number; episodes: number; plays: number; tracks: number; artists: number; first: string | null }>(
    `SELECT (SELECT count(*) FROM shows) shows,
            (SELECT count(*) FROM episodes WHERE track_count > 0) episodes,
            (SELECT count(*) FROM plays) plays, (SELECT count(*) FROM tracks) tracks, (SELECT count(*) FROM artists) artists,
            (SELECT min(broadcast_at) FROM episodes WHERE track_count > 0) first`,
  )!;
}

export function lastUpdated(): string | null {
  return get<{ value: string }>("SELECT value FROM meta WHERE key = 'aggregated_at'")?.value ?? null;
}

// ---------- artists ----------

export interface ArtistRow { id: number; name: string; slug: string }

export function pagedArtists(): ArtistRow[] {
  const ids = [...artistsWithPages().keys()];
  if (!ids.length) return [];
  // Chunk to stay well under SQLite's bound-parameter limit.
  const out: ArtistRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    out.push(...all<ArtistRow>(`SELECT id, name, slug FROM artists WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk));
  }
  return out;
}

export function artistDetail(id: number) {
  const stats = get<{ episodes: number; shows: number; tracks: number; first: string; last: string }>(
    `SELECT count(DISTINCT p.episode_alias) episodes, count(DISTINCT e.show_alias) shows,
            count(DISTINCT p.track_id) tracks, min(e.broadcast_at) first, max(e.broadcast_at) last
     FROM ${ARTIST_PLAYS} WHERE ta.artist_id = ?`,
    id,
  )!;
  const topTracks = all<{ id: number; title: string; artistDisplay: string; episodes: number; last: string }>(
    `SELECT t.id, t.title_display title, t.artist_display artistDisplay,
            count(DISTINCT p.episode_alias) episodes, max(e.broadcast_at) last
     FROM ${ARTIST_PLAYS} JOIN tracks t ON t.id = ta.track_id
     WHERE ta.artist_id = ? GROUP BY t.id ORDER BY episodes DESC, last DESC LIMIT 25`,
    id,
  );
  const shows = all<{ alias: string; name: string; episodes: number }>(
    `SELECT s.alias, coalesce(s.name, s.alias) name, count(DISTINCT p.episode_alias) episodes
     FROM ${ARTIST_PLAYS} JOIN shows s ON s.alias = e.show_alias
     WHERE ta.artist_id = ? GROUP BY s.alias ORDER BY episodes DESC, name LIMIT 25`,
    id,
  );
  const monthly = all<{ month: string; episodes: number }>(
    `SELECT strftime('%Y-%m', e.broadcast_at) month, count(DISTINCT p.episode_alias) episodes
     FROM ${ARTIST_PLAYS} WHERE ta.artist_id = ? GROUP BY month ORDER BY month`,
    id,
  );
  const recent = all<{ episode: string; show: string; showName: string; name: string; broadcast: string; title: string }>(
    `SELECT e.alias episode, e.show_alias show, coalesce(s.name, e.show_alias) showName, e.name, e.broadcast_at broadcast,
            t.title_display title
     FROM ${ARTIST_PLAYS} JOIN tracks t ON t.id = ta.track_id LEFT JOIN shows s ON s.alias = e.show_alias
     WHERE ta.artist_id = ? ORDER BY e.broadcast_at DESC, p.position LIMIT 20`,
    id,
  );
  const chartHistory = all<{ week: string; rank: number }>(
    `SELECT period_key week, rank FROM chart_entries
     WHERE entity_type = 'artist' AND entity_id = ? AND period_type = 'week' ORDER BY period_key`,
    id,
  );
  return { stats, topTracks, shows, monthly: fillMonths(monthly), recent, chartHistory };
}

/** Insert zero months between the first and last month so gaps show as gaps. */
function fillMonths(rows: { month: string; episodes: number }[]) {
  if (!rows.length) return rows;
  const byMonth = new Map(rows.map((r) => [r.month, r.episodes]));
  const out: { month: string; episodes: number }[] = [];
  let [y, m] = rows[0].month.split("-").map(Number);
  const last = rows[rows.length - 1].month;
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: key, episodes: byMonth.get(key) ?? 0 });
    if (key >= last) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// ---------- shows ----------

export interface ShowRow { alias: string; name: string; location: string | null; genres: string[]; image: string | null; episodes: number; last: string | null }

export function allShows(): ShowRow[] {
  return all<Omit<ShowRow, "genres"> & { genres_json: string | null }>(
    `SELECT s.alias, coalesce(s.name, s.alias) name, s.location, s.genres_json, s.image_url image,
            count(e.alias) episodes, max(e.broadcast_at) last
     FROM shows s JOIN episodes e ON e.show_alias = s.alias AND e.track_count > 0
     GROUP BY s.alias ORDER BY name COLLATE NOCASE`,
  ).map(({ genres_json, ...r }) => ({ ...r, genres: genres_json ? JSON.parse(genres_json) : [] }));
}

export function showDetail(alias: string) {
  const stats = get<{ episodes: number; plays: number; tracks: number; first: string; last: string }>(
    `SELECT count(DISTINCT e.alias) episodes, count(p.track_id) plays, count(DISTINCT p.track_id) tracks,
            min(e.broadcast_at) first, max(e.broadcast_at) last
     FROM episodes e JOIN plays p ON p.episode_alias = e.alias WHERE e.show_alias = ?`,
    alias,
  )!;
  const topArtists = all<{ id: number; name: string; slug: string; episodes: number }>(
    `SELECT a.id, a.name, a.slug, count(DISTINCT p.episode_alias) episodes
     FROM ${ARTIST_PLAYS} JOIN artists a ON a.id = ta.artist_id
     WHERE e.show_alias = ? GROUP BY a.id ORDER BY episodes DESC, a.name LIMIT 20`,
    alias,
  );
  const topTracks = all<{ id: number; title: string; artistDisplay: string; episodes: number }>(
    `SELECT t.id, t.title_display title, t.artist_display artistDisplay, count(DISTINCT p.episode_alias) episodes
     FROM plays p JOIN episodes e ON e.alias = p.episode_alias JOIN tracks t ON t.id = p.track_id
     WHERE e.show_alias = ? GROUP BY t.id HAVING episodes > 1 ORDER BY episodes DESC, t.title_display LIMIT 20`,
    alias,
  );
  const episodes = all<{ alias: string; name: string; broadcast: string; trackCount: number }>(
    `SELECT alias, name, broadcast_at broadcast, track_count trackCount FROM episodes
     WHERE show_alias = ? AND track_count > 0 ORDER BY broadcast_at DESC LIMIT 30`,
    alias,
  );
  const tracklists = new Map<string, { title: string; artists: ArtistRef[]; artistDisplay: string }[]>();
  if (episodes.length) {
    const rows = all<{ ep: string; trackId: number; title: string; artistDisplay: string }>(
      `SELECT p.episode_alias ep, t.id trackId, t.title_display title, t.artist_display artistDisplay
       FROM plays p JOIN tracks t ON t.id = p.track_id
       WHERE p.episode_alias IN (${episodes.map(() => "?").join(",")}) ORDER BY p.episode_alias, p.position`,
      ...episodes.map((e) => e.alias),
    );
    const artists = artistsForTracks([...new Set(rows.map((r) => r.trackId))]);
    for (const r of rows) {
      const list = tracklists.get(r.ep) ?? [];
      list.push({ title: r.title, artistDisplay: r.artistDisplay, artists: artists.get(r.trackId) ?? [] });
      tracklists.set(r.ep, list);
    }
  }
  return { stats, topArtists, topTracks, episodes, tracklists };
}

// ---------- episodes that played a track ----------

export interface EpisodePlay { episode: string; show: string; showName: string; name: string; broadcast: string }

/** SQL condition (and params) selecting a chart period's episodes (alias e). */
function periodFilter(type: PeriodType, key: string): { sql: string; params: string[] } {
  if (type === "all") return { sql: "", params: [] };
  if (type === "rolling") return { sql: "AND strftime('%G-W%V', e.broadcast_at) BETWEEN ? AND ?", params: [rollingStartKey(key), key] };
  const fmt = { week: "%G-W%V", month: "%Y-%m", year: "%Y" }[type];
  return { sql: `AND strftime('${fmt}', e.broadcast_at) = ?`, params: [key] };
}

/**
 * The episodes that played each track, newest first, optionally only within one chart period.
 * Returns at most `limit` per track, plus the total so callers can say "and N more".
 */
export function episodesForTracks(
  trackIds: number[],
  period?: { type: PeriodType; key: string },
  limit = 25,
): Map<number, { total: number; episodes: EpisodePlay[] }> {
  const out = new Map<number, { total: number; episodes: EpisodePlay[] }>();
  if (!trackIds.length) return out;
  const filter = period ? periodFilter(period.type, period.key) : { sql: "", params: [] };
  const where = filter.sql;
  const rows = all<EpisodePlay & { trackId: number; rn: number; total: number }>(
    `SELECT * FROM (
       SELECT p.track_id trackId, e.alias episode, e.show_alias show, coalesce(s.name, e.show_alias) showName,
              coalesce(e.name, e.alias) name, e.broadcast_at broadcast,
              row_number() OVER (PARTITION BY p.track_id ORDER BY e.broadcast_at DESC) rn,
              count(*) OVER (PARTITION BY p.track_id) total
       FROM (SELECT DISTINCT track_id, episode_alias FROM plays WHERE track_id IN (${trackIds.map(() => "?").join(",")})) p
       JOIN episodes e ON e.alias = p.episode_alias
       LEFT JOIN shows s ON s.alias = e.show_alias
       WHERE e.broadcast_at IS NOT NULL ${where}
     ) WHERE rn <= ? ORDER BY trackId, rn`,
    ...trackIds, ...filter.params, limit,
  );
  for (const { trackId, rn: _rn, total, ...ep } of rows) {
    const entry = out.get(trackId) ?? { total, episodes: [] };
    entry.episodes.push(ep);
    out.set(trackId, entry);
  }
  return out;
}
