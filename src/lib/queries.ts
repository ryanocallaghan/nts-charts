import { all, cached, get, memo } from "./db.ts";
import { CHART_MIN_SCORE, CHART_SIZE, GUEST_PAGES_SQL, GUESTS_SHOW, rankSql, SHOW_KEY } from "./shared-sql.ts";
import { DATED } from "./dates.ts";
import { ntsEpisodeUrl, periodBounds, rollingStartKey, type DatedPeriod, type PeriodType } from "./format.ts";
import { searchHref, searchMeta, searchNorm, type SearchKind, type SearchResult } from "./search.ts";

// NTS files one-off guest mixes under one catch-all show. Each guest counts as its own "show"
// (keyed 'guests/<slug>'); repeat guests get a page at /shows/guests/<slug>/.
export { GUESTS_SHOW };

export interface GuestRow { slug: string; name: string; mixes: number; last: string }
/** Repeat guests (with pages), by slug. Name is taken from their latest mix. */
export function guestPages(): Map<string, GuestRow> {
  return memo("guestPages", () => new Map(all<GuestRow>(GUEST_PAGES_SQL).map((g) => [g.slug, g])));
}

/** Where a show-or-guest key links: a show page, a repeat guest's page, or a one-off guest's mix on nts.live. */
export function showLink(r: { show: string; guest: string | null; showName: string; guestName: string | null; anyEpisode: string }) {
  if (!r.guest) return { name: r.showName, href: `/shows/${r.show}/`, guest: false };
  const page = guestPages().get(r.guest);
  return page
    ? { name: page.name, href: `/shows/guests/${r.guest}/`, guest: true }
    : { name: (r.guestName ?? r.guest).trim(), href: ntsEpisodeUrl(r.show, r.anyEpisode), guest: true };
}

export interface ThemeOf { name: string; href: string }
/** For each track that is some show's theme tune, the show(s) it opens or closes. */
export function themeTunesFor(trackIds: number[]): Map<number, ThemeOf[]> {
  const out = new Map<number, ThemeOf[]>();
  if (!trackIds.length) return out;
  for (const r of all<{ trackId: number; key: string; showName: string | null }>(
    `SELECT tt.track_id trackId, tt.show_key key, s.name showName FROM theme_tunes tt LEFT JOIN shows s ON s.alias = tt.show_key
     WHERE tt.track_id IN (${trackIds.map(() => "?").join(",")})`,
    ...trackIds,
  )) {
    const guest = r.key.startsWith("guests/") ? guestPages().get(r.key.slice(7)) : undefined;
    const theme = guest
      ? { name: guest.name, href: `/shows/guests/${guest.slug}/` }
      : { name: r.showName ?? r.key, href: `/shows/${r.key}/` };
    out.set(r.trackId, [...(out.get(r.trackId) ?? []), theme]);
  }
  return out;
}

// Shared FROM clause: an artist's plays.
const ARTIST_PLAYS = `track_artists ta
  JOIN plays p ON p.track_id = ta.track_id
  JOIN episodes e ON e.alias = p.episode_alias`;

export interface ArtistRef { id: number; name: string; slug: string }

/** Credited artists per track, in credit order. */
export function artistsForTracks(trackIds: number[]): Map<number, ArtistRef[]> {
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

/** Chart period keys, oldest first. Shared and cached: copy before sorting or reversing. */
export function periodKeys(type: PeriodType): readonly string[] {
  return memo(`periodKeys:${type}`, () =>
    Object.freeze(all<{ k: string }>("SELECT DISTINCT period_key k FROM chart_entries WHERE period_type = ? ORDER BY k", type).map((r) => r.k)),
  );
}

export interface Movement { rank: number; prevRank: number | null; status: string; periodsOnChart: number; score: number; shows: number }
export interface TrackEntry extends Movement { id: number; title: string; artistDisplay: string; artists: ArtistRef[] }
export interface ArtistEntry extends Movement { id: number; name: string; slug: string }

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
  return memo("siteStats", () => get<{ shows: number; episodes: number; plays: number; tracks: number; artists: number; first: string | null }>(
    `SELECT (SELECT count(*) FROM shows) shows,
            (SELECT count(*) FROM episodes WHERE track_count > 0) episodes,
            (SELECT count(*) FROM plays) plays, (SELECT count(*) FROM tracks) tracks, (SELECT count(*) FROM artists) artists,
            (SELECT min(broadcast_at) FROM episodes e WHERE track_count > 0 AND ${DATED}) first`,
  )!);
}

export function lastUpdated(): string | null {
  return get<{ value: string }>("SELECT value FROM meta WHERE key = 'aggregated_at'")?.value ?? null;
}

// ---------- artists ----------

export interface ArtistRow { id: number; name: string; slug: string }

/** The artist at /artists/<slug>/, if there is one. */
export function artistBySlug(slug: string): ArtistRow | undefined {
  return get<ArtistRow>("SELECT id, name, slug FROM artists WHERE slug = ?", slug);
}

export interface ArtistInfo {
  mbid: string;
  type: string | null;
  area: string | null;
  begin_year: number | null;
  end_year: number | null;
  disambiguation: string | null;
  bio: string | null;
  bio_source: "wikipedia" | "musicbrainz" | null;
  bio_url: string | null;
  links: { bandcamp?: string; instagram?: string; discogs?: string };
}

/** MusicBrainz/Wikipedia info for an artist, when ingest/enrich.ts found a confident match. */
export function artistInfo(id: number): ArtistInfo | null {
  const r = get<Omit<ArtistInfo, "links"> & { links_json: string | null }>(
    `SELECT mbid, type, area, begin_year, end_year, disambiguation, bio, bio_source, bio_url, links_json
     FROM artist_info WHERE artist_id = ? AND mbid IS NOT NULL`,
    id,
  );
  if (!r) return null;
  const { links_json, ...rest } = r;
  return { ...rest, links: links_json ? JSON.parse(links_json) : {} };
}

export function artistDetail(id: number) {
  const stats = get<{ episodes: number; shows: number; tracks: number; first: string | null; last: string | null }>(
    `SELECT count(DISTINCT p.episode_alias) episodes, count(DISTINCT ${SHOW_KEY}) shows,
            count(DISTINCT p.track_id) tracks,
            min(CASE WHEN ${DATED} THEN e.broadcast_at END) first, max(CASE WHEN ${DATED} THEN e.broadcast_at END) last
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
  const shows = all<{ show: string; guest: string | null; showName: string; guestName: string | null; anyEpisode: string; episodes: number }>(
    `SELECT e.show_alias show, e.guest_slug guest, coalesce(s.name, e.show_alias) showName, max(e.name) guestName,
            max(e.alias) anyEpisode, count(DISTINCT p.episode_alias) episodes
     FROM ${ARTIST_PLAYS} LEFT JOIN shows s ON s.alias = e.show_alias
     WHERE ta.artist_id = ? GROUP BY ${SHOW_KEY} ORDER BY episodes DESC, showName LIMIT 25`,
    id,
  ).map((r) => ({ ...showLink(r), key: r.guest ? `guests/${r.guest}` : r.show, episodes: r.episodes }));
  const monthly = all<{ month: string; episodes: number }>(
    `SELECT strftime('%Y-%m', e.broadcast_at) month, count(DISTINCT p.episode_alias) episodes
     FROM ${ARTIST_PLAYS} WHERE ta.artist_id = ? AND ${DATED} GROUP BY month ORDER BY month`,
    id,
  );
  const recent = all<{ episode: string; show: string; showName: string; name: string; broadcast: string; id: number; title: string; artistDisplay: string }>(
    `SELECT e.alias episode, e.show_alias show, coalesce(s.name, e.show_alias) showName, e.name, e.broadcast_at broadcast,
            t.id, t.title_display title, t.artist_display artistDisplay
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

/** Every show with a tracklist, by name. Shared and cached: copy before sorting. */
export function allShows(): readonly ShowRow[] {
  return memo("allShows", () => Object.freeze(all<Omit<ShowRow, "genres"> & { genres_json: string | null }>(
    `SELECT s.alias, coalesce(s.name, s.alias) name, s.location, s.genres_json, s.image_url image,
            count(e.alias) episodes, max(e.broadcast_at) last
     FROM shows s JOIN episodes e ON e.show_alias = s.alias AND e.track_count > 0
     GROUP BY s.alias ORDER BY name COLLATE NOCASE`,
  ).map(({ genres_json, ...r }) => ({ ...r, genres: genres_json ? JSON.parse(genres_json) : [] }))));
}

/** The show at /shows/<alias>/ (one with at least one tracklist), if there is one. */
export function showByAlias(alias: string): ShowRow | undefined {
  return memo("showsByAlias", () => new Map(allShows().map((s) => [s.alias, s]))).get(alias);
}

export const SHOW_EPISODES_PER_PAGE = 50;

/**
 * A show's page data, or a repeat guest's (their mixes on the catch-all guests show): totals and
 * most-played artists and tracks over every episode (cached per show), and one page of its episodes,
 * newest first, with their tracklists.
 */
export function showDetail(alias: string, guest?: string, page = 1) {
  const [col, key] = guest ? ["guest_slug", guest] : ["show_alias", alias];
  // A guest's page lists every mix, even ones without a tracklist; a show's, those with one.
  const listed = `${col} = ? AND broadcast_at IS NOT NULL ${guest ? "" : "AND track_count > 0"}`;
  const { stats, topArtists, topTracks, episodeTotal } = cached(`showSummary:${col}:${key}`, () => showSummary(col, key, listed));
  const pages = Math.max(1, Math.ceil(episodeTotal / SHOW_EPISODES_PER_PAGE));
  const episodes = all<{ alias: string; name: string; broadcast: string; trackCount: number; guest: string | null }>(
    `SELECT alias, trim(coalesce(name, alias)) name, broadcast_at broadcast, coalesce(track_count, 0) trackCount, guest_slug guest
     FROM episodes WHERE ${listed} ORDER BY broadcast_at DESC LIMIT ? OFFSET ?`,
    key, SHOW_EPISODES_PER_PAGE, (page - 1) * SHOW_EPISODES_PER_PAGE,
  );
  const tracklists = new Map<string, { id: number; title: string; artists: ArtistRef[]; artistDisplay: string }[]>();
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
      list.push({ id: r.trackId, title: r.title, artistDisplay: r.artistDisplay, artists: artists.get(r.trackId) ?? [] });
      tracklists.set(r.ep, list);
    }
  }
  return { stats, topArtists, topTracks, episodes, tracklists, episodeTotal, page, pages };
}

/** Totals and most-played artists and tracks over every one of a show's (or guest's) episodes. */
function showSummary(col: string, key: string, listed: string) {
  const stats = get<{ episodes: number; plays: number; tracks: number; first: string; last: string }>(
    `SELECT count(DISTINCT e.alias) episodes, count(p.track_id) plays, count(DISTINCT p.track_id) tracks,
            min(CASE WHEN ${DATED} THEN e.broadcast_at END) first, max(CASE WHEN ${DATED} THEN e.broadcast_at END) last
     FROM episodes e JOIN plays p ON p.episode_alias = e.alias WHERE e.${col} = ?`,
    key,
  )!;
  const topArtists = all<{ id: number; name: string; slug: string; episodes: number }>(
    `SELECT a.id, a.name, a.slug, count(DISTINCT p.episode_alias) episodes
     FROM ${ARTIST_PLAYS} JOIN artists a ON a.id = ta.artist_id
     WHERE e.${col} = ? GROUP BY a.id ORDER BY episodes DESC, a.name LIMIT 20`,
    key,
  );
  const topTracks = all<{ id: number; title: string; artistDisplay: string; episodes: number }>(
    `SELECT t.id, t.title_display title, t.artist_display artistDisplay, count(DISTINCT p.episode_alias) episodes
     FROM plays p JOIN episodes e ON e.alias = p.episode_alias JOIN tracks t ON t.id = p.track_id
     WHERE e.${col} = ? GROUP BY t.id HAVING episodes > 1 ORDER BY episodes DESC, t.title_display LIMIT 20`,
    key,
  );
  const episodeTotal = get<{ n: number }>(`SELECT count(*) n FROM episodes WHERE ${listed}`, key)!.n;
  return Object.freeze({ stats, topArtists, topTracks, episodeTotal });
}

// ---------- tracks ----------

export interface TrackRow { id: number; title: string; artistDisplay: string; deezerId: number | null }

export function trackById(id: number): TrackRow | undefined {
  return get<TrackRow>("SELECT id, title_display title, artist_display artistDisplay, deezer_id deezerId FROM tracks WHERE id = ?", id);
}

const TRACK_PLAYS = "plays p JOIN episodes e ON e.alias = p.episode_alias";
export const TRACK_EPISODES_PER_PAGE = 50;

/** A track's page: totals, who played it first, plays per month, weekly chart run, shows, and a page of episodes. */
export function trackDetail(id: number, page = 1) {
  const stats = get<{ episodes: number; shows: number; first: string | null; last: string | null }>(
    `SELECT count(DISTINCT p.episode_alias) episodes, count(DISTINCT ${SHOW_KEY}) shows,
            min(CASE WHEN ${DATED} THEN e.broadcast_at END) first, max(CASE WHEN ${DATED} THEN e.broadcast_at END) last
     FROM ${TRACK_PLAYS} WHERE p.track_id = ? AND e.broadcast_at IS NOT NULL`,
    id,
  )!;
  const firstRow = get<{ show: string; guest: string | null; showName: string; guestName: string | null; anyEpisode: string; name: string; broadcast: string }>(
    `SELECT e.show_alias show, e.guest_slug guest, coalesce(s.name, e.show_alias) showName, e.name guestName, e.alias anyEpisode,
            trim(coalesce(e.name, e.alias)) name, e.broadcast_at broadcast
     FROM ${TRACK_PLAYS} LEFT JOIN shows s ON s.alias = e.show_alias
     WHERE p.track_id = ? AND ${DATED} ORDER BY e.broadcast_at, e.alias LIMIT 1`,
    id,
  );
  const first = firstRow && {
    by: showLink(firstRow),
    episode: { name: firstRow.name, href: ntsEpisodeUrl(firstRow.show, firstRow.anyEpisode), broadcast: firstRow.broadcast },
  };
  const monthly = all<{ month: string; episodes: number }>(
    `SELECT strftime('%Y-%m', e.broadcast_at) month, count(DISTINCT p.episode_alias) episodes
     FROM ${TRACK_PLAYS} WHERE p.track_id = ? AND ${DATED} GROUP BY month ORDER BY month`,
    id,
  );
  const chartHistory = all<{ week: string; rank: number }>(
    `SELECT period_key week, rank FROM chart_entries
     WHERE entity_type = 'track' AND entity_id = ? AND period_type = 'week' ORDER BY period_key`,
    id,
  );
  const shows = all<{ show: string; guest: string | null; showName: string; guestName: string | null; anyEpisode: string; episodes: number }>(
    `SELECT e.show_alias show, e.guest_slug guest, coalesce(s.name, e.show_alias) showName, max(e.name) guestName,
            max(e.alias) anyEpisode, count(DISTINCT p.episode_alias) episodes
     FROM ${TRACK_PLAYS} LEFT JOIN shows s ON s.alias = e.show_alias
     WHERE p.track_id = ? GROUP BY ${SHOW_KEY} ORDER BY episodes DESC, showName LIMIT 25`,
    id,
  ).map((r) => ({ ...showLink(r), episodes: r.episodes }));
  const episodes = all<EpisodePlay>(
    `SELECT DISTINCT e.alias episode, e.show_alias show, coalesce(s.name, e.show_alias) showName,
            trim(coalesce(e.name, e.alias)) name, e.broadcast_at broadcast
     FROM ${TRACK_PLAYS} LEFT JOIN shows s ON s.alias = e.show_alias
     WHERE p.track_id = ? AND e.broadcast_at IS NOT NULL ORDER BY e.broadcast_at DESC, e.alias LIMIT ? OFFSET ?`,
    id, TRACK_EPISODES_PER_PAGE, (page - 1) * TRACK_EPISODES_PER_PAGE,
  );
  return { stats, first, monthly: fillMonths(monthly), chartHistory, shows, episodes };
}

/**
 * Each entity's rank in the `n` charts of this type up to and including `key` (null where it wasn't on
 * the chart), oldest first: for sparklines in chart tables.
 */
export function rankHistories(type: PeriodType, key: string, entity: "track" | "artist", ids: number[], n = 8): Map<number, (number | null)[]> {
  const out = new Map<number, (number | null)[]>();
  const keys = periodKeys(type);
  const end = keys.indexOf(key);
  if (end < 0 || !ids.length) return out;
  const window = keys.slice(Math.max(0, end - n + 1), end + 1);
  for (const id of ids) out.set(id, window.map(() => null));
  const rows = all<{ id: number; k: string; rank: number }>(
    `SELECT entity_id id, period_key k, rank FROM chart_entries
     WHERE period_type = ? AND entity_type = ? AND period_key IN (${window.map(() => "?").join(",")})
       AND entity_id IN (${ids.map(() => "?").join(",")})`,
    type, entity, ...window, ...ids,
  );
  const at = new Map(window.map((k, i) => [k, i]));
  for (const r of rows) out.get(r.id)![at.get(r.k)!] = r.rank;
  return out;
}

// ---------- episodes that played a track ----------

export interface EpisodePlay { episode: string; show: string; showName: string; name: string; broadcast: string }

/** SQL condition (and params) selecting a chart period's episodes (alias e). */
function periodFilter(type: PeriodType, key: string): { sql: string; params: string[] } {
  if (type === "all") return { sql: "", params: [] };
  if (type === "rolling") return { sql: "AND strftime('%G-W%V', e.broadcast_at) BETWEEN ? AND ?", params: [rollingStartKey(key), key] };
  if (type === "quarter") {
    return { sql: "AND strftime('%Y', e.broadcast_at) || '-Q' || ((CAST(strftime('%m', e.broadcast_at) AS INTEGER) + 2) / 3) = ?", params: [key] };
  }
  const fmt = { week: "%G-W%V", month: "%Y-%m", year: "%Y" }[type];
  return { sql: `AND strftime('${fmt}', e.broadcast_at) = ?`, params: [key] };
}

/**
 * The episodes that played each track, newest first, optionally only within one chart period.
 * Returns at most `limit` per track, plus the total so callers can say "and N more".
 */
export function episodesForTracks(
  trackIds: number[],
  period?: { type: PeriodType; key: string; filter?: ChartFilter },
  limit = 25,
): Map<number, { total: number; episodes: EpisodePlay[] }> {
  const out = new Map<number, { total: number; episodes: EpisodePlay[] }>();
  if (!trackIds.length) return out;
  const filter = period ? periodFilter(period.type, period.key) : { sql: "", params: [] };
  if (period?.filter) {
    const f = filterWhere(period.filter, "e.");
    filter.sql += ` AND ${f.sql}`;
    filter.params = [...filter.params, ...f.params];
  }
  // In a chart, leave out theme-tune plays, which don't count towards the chart (see theme_tunes).
  const where = filter.sql + (period
    ? ` AND NOT EXISTS (SELECT 1 FROM theme_tunes tt WHERE tt.show_key = ${SHOW_KEY} AND tt.track_id = p.track_id)`
    : "");
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

// ---------- search ----------

const SEARCH_MAX_WORDS = 8;

/**
 * Artists, shows and repeat guests whose names contain a word starting with each query word.
 * Exact names first, then names that start with the query, then the most played.
 * `short` means the query is too short to search (no word of two or more characters).
 */
export function search(query: string, limit = 50): { short: boolean; total: number; results: SearchResult[] } {
  const q = searchNorm(query);
  const words = q.split(" ").filter(Boolean).slice(0, SEARCH_MAX_WORDS);
  if (!words.some((w) => w.length >= 2)) return { short: words.length > 0, total: 0, results: [] };
  // searchNorm leaves only letters, digits and spaces, so quoting each word is safe.
  const match = words.map((w) => `"${w}"*`).join(" ");
  const rows = all<{ name: string; kind: SearchKind; key: string; episodes: number; total: number }>(
    `SELECT name, kind, key, episodes, count(*) OVER () total FROM search_index WHERE search_index MATCH ?
     ORDER BY norm = ? DESC, substr(norm, 1, length(?)) = ? DESC, episodes DESC, name LIMIT ?`,
    match, q, q, q, limit,
  );
  return {
    short: false,
    total: rows[0]?.total ?? 0,
    results: rows.map((r) => ({ name: r.name, href: searchHref(r.kind, r.key), meta: searchMeta(r.kind, r.episodes) })),
  };
}

// ---------- genres and places ----------

export interface GenreRow { slug: string; name: string; episodes: number }

/** Every genre, biggest first. */
export function allGenres(): readonly GenreRow[] {
  return memo("genres", () => Object.freeze(all<GenreRow>("SELECT slug, name, episodes FROM genres ORDER BY episodes DESC, name")));
}

export function genreBySlug(slug: string): GenreRow | undefined {
  return memo("genresBySlug", () => new Map(allGenres().map((g) => [g.slug, g]))).get(slug);
}

// Charts can be narrowed to genres and places with enough episodes to make a chart worth reading.
const FILTER_MIN_EPISODES = 200;

/** Genres offered as chart filters, by name. */
export function filterGenres(): readonly GenreRow[] {
  return memo("filterGenres", () => Object.freeze(
    allGenres().filter((g) => g.episodes >= FILTER_MIN_EPISODES).sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
  ));
}

export interface PlaceRow { name: string; episodes: number }

/** Places that episodes are broadcast from, offered as chart filters, busiest first. */
export function filterPlaces(): readonly PlaceRow[] {
  return memo("filterPlaces", () => Object.freeze(all<PlaceRow>(
    `SELECT location name, count(*) episodes FROM episodes e
     WHERE track_count > 0 AND ${DATED} AND location IS NOT NULL AND location != ''
     GROUP BY location HAVING episodes >= ? ORDER BY episodes DESC, name`,
    FILTER_MIN_EPISODES,
  )));
}

/** A chart narrowed to episodes tagged with a genre and/or broadcast from a place. */
export interface ChartFilter { genre?: GenreRow; place?: string }

export function filterLabel(f: ChartFilter): string {
  return [f.genre?.name, f.place && `from ${f.place}`].filter(Boolean).join(", ");
}

/** SQL condition on episodes for a filter; `prefix` qualifies the columns (e.g. "e."). */
function filterWhere(f: ChartFilter, prefix = ""): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (f.genre) { parts.push(`${prefix}alias IN (SELECT episode_alias FROM episode_genres WHERE genre_slug = ?)`); params.push(f.genre.slug); }
  if (f.place) { parts.push(`${prefix}location = ?`); params.push(f.place); }
  return { sql: parts.join(" AND ") || "1", params };
}

const filterKey = (f: ChartFilter) => `${f.genre?.slug ?? ""}|${f.place ?? ""}`;

type RankRow = { entityId: number; rank: number; score: number; shows: number };

/** One period's filtered ranking, cached. Ranked exactly like the main charts (rankSql). */
function rankFiltered(type: PeriodType, key: string, entity: "track" | "artist", filter: ChartFilter, range: { start: Date; end: Date }): RankRow[] {
  return cached(`rank:${type}:${key}:${entity}:${filterKey(filter)}:${range.start.toISOString()}:${range.end.toISOString()}`, () => {
    const w = filterWhere(filter);
    return all<RankRow>(
      rankSql(type, entity, { where: w.sql, range: true, onePeriod: true }),
      range.start.toISOString(), range.end.toISOString(), ...w.params, key, CHART_MIN_SCORE, CHART_SIZE,
    );
  });
}

function withPrevious(rows: RankRow[], prev: RankRow[] | null): Movement[] {
  const before = new Map((prev ?? []).map((r) => [r.entityId, r.rank]));
  return rows.map((r) => {
    const prevRank = before.get(r.entityId) ?? null;
    const status = prevRank == null ? "new" : prevRank > r.rank ? "up" : prevRank < r.rank ? "down" : "same";
    return { rank: r.rank, prevRank, status, periodsOnChart: 0, score: r.score, shows: r.shows };
  });
}

function resolveTracks(rows: RankRow[], moves: Movement[]): TrackEntry[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.entityId);
  const info = new Map(all<{ id: number; title: string; artistDisplay: string }>(
    `SELECT id, title_display title, artist_display artistDisplay FROM tracks WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids,
  ).map((t) => [t.id, t]));
  const credits = artistsForTracks(ids);
  return rows.map((r, i) => ({ ...moves[i], ...info.get(r.entityId)!, artists: credits.get(r.entityId) ?? [] }));
}

function resolveArtists(rows: RankRow[], moves: Movement[]): ArtistEntry[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.entityId);
  const info = new Map(all<{ id: number; name: string; slug: string }>(
    `SELECT id, name, slug FROM artists WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids,
  ).map((a) => [a.id, a]));
  return rows.map((r, i) => ({ ...moves[i], ...info.get(r.entityId)! }));
}

/**
 * A chart period narrowed to a genre and/or place: tracks and artists, with movement against the
 * same filter's previous period (no re-entries or weeks-on-chart: those need the whole history).
 */
export function filteredChart(type: DatedPeriod, key: string, filter: ChartFilter) {
  const keys = periodKeys(type);
  const prevKey = keys[keys.indexOf(key) - 1];
  const result = (entity: "track" | "artist") => {
    const rows = rankFiltered(type, key, entity, filter, periodBounds(type, key));
    const prev = prevKey ? rankFiltered(type, prevKey, entity, filter, periodBounds(type, prevKey)) : null;
    return { rows, moves: withPrevious(rows, prev) };
  };
  const t = result("track");
  const a = result("artist");
  return { tracks: resolveTracks(t.rows, t.moves), artists: resolveArtists(a.rows, a.moves) };
}

/** Top tracks and artists for a filter over any date range (e.g. the last 12 months), without movement. */
export function windowChart(filter: ChartFilter, start: Date, end: Date, limit = 20) {
  const pick = (entity: "track" | "artist") => rankFiltered("all", "all", entity, filter, { start, end }).slice(0, limit);
  const t = pick("track");
  const a = pick("artist");
  return { tracks: resolveTracks(t, withPrevious(t, null)), artists: resolveArtists(a, withPrevious(a, null)) };
}

/** Episodes with at least one genre tag, per year (the base for every genre's yearly share). */
function taggedEpisodesByYear(): Map<string, number> {
  return memo("taggedEpisodesByYear", () => new Map(all<{ year: string; n: number }>(
    `SELECT strftime('%Y', e.broadcast_at) year, count(*) n FROM episodes e
     WHERE track_count > 0 AND ${DATED} AND genres_json IS NOT NULL AND genres_json != '[]' GROUP BY year ORDER BY year`,
  ).map((r) => [r.year, r.n])));
}

/** A genre's page: totals, its share of tagged episodes each year, the shows that tag it most, and its neighbours. */
export function genreDetail(slug: string) {
  return cached(`genre:${slug}`, () => {
    const stats = get<{ episodes: number; shows: number; first: string | null; last: string | null }>(
      `SELECT count(*) episodes, count(DISTINCT ${SHOW_KEY}) shows, min(e.broadcast_at) first, max(e.broadcast_at) last
       FROM episode_genres eg JOIN episodes e ON e.alias = eg.episode_alias WHERE eg.genre_slug = ?`,
      slug,
    )!;
    const tagged = new Map(all<{ year: string; n: number }>(
      `SELECT strftime('%Y', e.broadcast_at) year, count(*) n FROM episode_genres eg JOIN episodes e ON e.alias = eg.episode_alias
       WHERE eg.genre_slug = ? GROUP BY year`,
      slug,
    ).map((r) => [r.year, r.n]));
    const years = [...taggedEpisodesByYear()].map(([year, total]) => ({ year, tagged: tagged.get(year) ?? 0, total }));
    const shows = all<{ show: string; guest: string | null; showName: string; guestName: string | null; anyEpisode: string; episodes: number; of: number }>(
      `SELECT e.show_alias show, e.guest_slug guest, coalesce(s.name, e.show_alias) showName, max(e.name) guestName,
              max(e.alias) anyEpisode, count(*) episodes
       FROM episode_genres eg JOIN episodes e ON e.alias = eg.episode_alias LEFT JOIN shows s ON s.alias = e.show_alias
       WHERE eg.genre_slug = ? GROUP BY ${SHOW_KEY} ORDER BY episodes DESC, showName LIMIT 20`,
      slug,
    ).map((r) => ({ ...showLink(r), episodes: r.episodes }));
    // Genres most often tagged alongside this one.
    const neighbours = all<GenreRow & { together: number }>(
      `SELECT g.slug, g.name, g.episodes, count(*) together
       FROM episode_genres a JOIN episode_genres b ON b.episode_alias = a.episode_alias AND b.genre_slug != a.genre_slug
       JOIN genres g ON g.slug = b.genre_slug
       WHERE a.genre_slug = ? GROUP BY g.slug ORDER BY together DESC, g.name LIMIT 12`,
      slug,
    );
    return { stats, years, shows, neighbours };
  });
}

/** Each quarter's genre tags since 2011: the top `n` genres' shares of all tags (the rest is every other genre). */
export function genreRiver(n = 7) {
  return memo(`genreRiver:${n}`, () => {
    const rows = all<{ q: string; slug: string; tags: number }>("SELECT quarter q, genre_slug slug, tags FROM genre_quarters");
    const top = allGenres().slice(0, n);
    const quarters = [...new Set(rows.map((r) => r.q))].sort();
    const totals = new Map<string, number>();
    const by = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.q, (totals.get(r.q) ?? 0) + r.tags);
      by.set(`${r.q}|${r.slug}`, r.tags);
    }
    const share = (q: string, tags: number) => Math.round((1000 * tags) / (totals.get(q) || 1)) / 10;
    const series = top.map((g) => ({ name: g.name, slug: g.slug, values: quarters.map((q) => share(q, by.get(`${q}|${g.slug}`) ?? 0)) }));
    return { quarters, series, others: allGenres().length - top.length };
  });
}

// ---------- related artists, similar shows, firsts ----------

export interface RelatedArtist { id: number; name: string; slug: string; shared: number; score: number }

/**
 * Artists most often played in the same episodes, scored shared / sqrt(episodes × theirs) so the
 * biggest names don't top every list. At least 3 shared episodes.
 */
export function relatedArtists(id: number, limit = 12): RelatedArtist[] {
  return all<RelatedArtist>(
    `SELECT a.id, a.name, a.slug, s.n shared,
            s.n / sqrt(st.episodes * (SELECT episodes FROM artist_stats WHERE artist_id = ?)) score
     FROM (SELECT o.artist_id id, count(*) n FROM episode_artists m JOIN episode_artists o ON o.episode_id = m.episode_id
           WHERE m.artist_id = ? AND o.artist_id != ? GROUP BY o.artist_id HAVING n >= 3) s
     JOIN artist_stats st ON st.artist_id = s.id JOIN artists a ON a.id = s.id
     ORDER BY score DESC, s.n DESC LIMIT ?`,
    id, id, id, limit,
  );
}

/** The first (dated) episode that played an artist, and who it was by. */
export function artistFirstPlay(id: number) {
  const r = get<{ show: string; guest: string | null; showName: string; guestName: string | null; anyEpisode: string; name: string; broadcast: string }>(
    `SELECT e.show_alias show, e.guest_slug guest, coalesce(s.name, e.show_alias) showName, e.name guestName, e.alias anyEpisode,
            trim(coalesce(e.name, e.alias)) name, e.broadcast_at broadcast
     FROM episode_artists ea JOIN episodes e ON e.rowid = ea.episode_id LEFT JOIN shows s ON s.alias = e.show_alias
     WHERE ea.artist_id = ? ORDER BY e.broadcast_at, e.alias LIMIT 1`,
    id,
  );
  return r && { by: showLink(r), episode: { name: r.name, href: ntsEpisodeUrl(r.show, r.anyEpisode), broadcast: r.broadcast } };
}

export interface ShowRef { key: string; name: string; href: string }

/** Name and link for a show key (a show alias, or 'guests/<slug>' for a repeat guest). */
function showRef(key: string): ShowRef | undefined {
  if (key.startsWith("guests/")) {
    const g = guestPages().get(key.slice(7));
    return g && { key, name: g.name, href: `/shows/guests/${g.slug}/` };
  }
  const s = showByAlias(key);
  return s && { key, name: s.name, href: `/shows/${s.alias}/` };
}

/** The shows (and repeat guests) that play the most similar artists. */
export function similarShows(key: string): (ShowRef & { score: number })[] {
  return all<{ other: string; score: number }>("SELECT other_key other, score FROM show_similar WHERE show_key = ? ORDER BY score DESC", key)
    .flatMap((r) => { const s = showRef(r.other); return s ? [{ ...s, score: r.score }] : []; });
}

/**
 * For the connections graph: which of the related artists were also played on which of the shows
 * (episodes in common), so the graph shows a web rather than a star.
 */
export function artistShowLinks(artistIds: number[], showKeys: string[]): { artist: number; show: string; episodes: number }[] {
  if (!artistIds.length || !showKeys.length) return [];
  return all<{ artist: number; show: string; episodes: number }>(
    `SELECT ea.artist_id artist, ${SHOW_KEY} show, count(*) episodes
     FROM episode_artists ea JOIN episodes e ON e.rowid = ea.episode_id
     WHERE ea.artist_id IN (${artistIds.map(() => "?").join(",")}) AND ${SHOW_KEY} IN (${showKeys.map(() => "?").join(",")})
     GROUP BY artist, show`,
    ...artistIds, ...showKeys,
  );
}

// ---------- tastemakers ----------

export interface Tastemaker extends ShowRef { tracks: number; weeksEarly: number }

/**
 * Shows that play tracks before they chart: tracks played in the 12 weeks before their first week on
 * the weekly chart, since `sinceWeek` (a week key) or all time. Ranked by tracks, then how early.
 */
export function tastemakers(sinceWeek: string | null, limit = 25): Tastemaker[] {
  return memo(`tastemakers:${sinceWeek}:${limit}`, () =>
    all<{ key: string; tracks: number; weeksEarly: number }>(
      `SELECT show_key key, count(*) tracks, round(avg(weeks_early), 1) weeksEarly FROM early_plays
       WHERE chart_week >= ? GROUP BY show_key ORDER BY tracks DESC, weeksEarly DESC LIMIT ?`,
      sinceWeek ?? "", limit * 2,
    ).flatMap((r) => { const s = showRef(r.key); return s ? [{ ...s, tracks: r.tracks, weeksEarly: r.weeksEarly }] : []; }).slice(0, limit),
  );
}

/** A show's early plays: how many tracks it played before they charted, and the latest few. */
export function showEarlyPlays(key: string, limit = 10) {
  const total = get<{ n: number; w: number | null }>("SELECT count(*) n, round(avg(weeks_early), 1) w FROM early_plays WHERE show_key = ?", key)!;
  const recent = all<{ id: number; title: string; artistDisplay: string; week: string; weeksEarly: number }>(
    `SELECT t.id, t.title_display title, t.artist_display artistDisplay, ep.chart_week week, ep.weeks_early weeksEarly
     FROM early_plays ep JOIN tracks t ON t.id = ep.track_id WHERE ep.show_key = ? ORDER BY ep.chart_week DESC LIMIT ?`,
    key, limit,
  );
  return { tracks: total.n, weeksEarly: total.w, recent };
}

// ---------- year in review ----------

/** A year's review: totals, artists new to NTS, the biggest climbers, genre shifts and the busiest shows. */
export function yearReview(year: string) {
  return cached(`year:${year}`, () => {
    const from = `${year}-01-01`, to = `${Number(year) + 1}-01-01`;
    const prevFrom = `${Number(year) - 1}-01-01`;
    const stats = get<{ episodes: number; plays: number; tracks: number; artists: number; newArtists: number }>(
      `SELECT (SELECT count(*) FROM episodes WHERE track_count > 0 AND broadcast_at >= ? AND broadcast_at < ?) episodes,
              (SELECT count(*) FROM plays p JOIN episodes e ON e.alias = p.episode_alias WHERE e.broadcast_at >= ? AND e.broadcast_at < ?) plays,
              (SELECT count(DISTINCT p.track_id) FROM plays p JOIN episodes e ON e.alias = p.episode_alias WHERE e.broadcast_at >= ? AND e.broadcast_at < ?) tracks,
              (SELECT count(DISTINCT ea.artist_id) FROM episode_artists ea JOIN episodes e ON e.rowid = ea.episode_id WHERE e.broadcast_at >= ? AND e.broadcast_at < ?) artists,
              (SELECT count(*) FROM artist_stats WHERE first_at >= ? AND first_at < ?) newArtists`,
      from, to, from, to, from, to, from, to, from, to,
    )!;
    // Episodes per artist this year and last, for new arrivals and climbers.
    const counts = all<{ id: number; name: string; slug: string; cur: number; prev: number; first: string }>(
      `SELECT a.id, a.name, a.slug, c.cur, c.prev, st.first_at first FROM (
         SELECT ea.artist_id id, sum(e.broadcast_at >= ?) cur, sum(e.broadcast_at < ?) prev
         FROM episode_artists ea JOIN episodes e ON e.rowid = ea.episode_id
         WHERE e.broadcast_at >= ? AND e.broadcast_at < ? GROUP BY ea.artist_id HAVING cur >= 3) c
       JOIN artists a ON a.id = c.id JOIN artist_stats st ON st.artist_id = c.id`,
      from, from, prevFrom, to,
    );
    const newcomers = counts.filter((c) => c.first >= from && c.first < to).sort((a, b) => b.cur - a.cur || a.name.localeCompare(b.name)).slice(0, 15);
    const climbers = counts.filter((c) => c.prev > 0).map((c) => ({ ...c, gain: c.cur - c.prev }))
      .filter((c) => c.gain > 0).sort((a, b) => b.gain - a.gain || b.cur - a.cur).slice(0, 15);
    // Genres' share of tags this year vs last.
    const tagRows = all<{ y: string; slug: string; name: string; tags: number }>(
      `SELECT substr(gq.quarter, 1, 4) y, gq.genre_slug slug, g.name, sum(gq.tags) tags FROM genre_quarters gq JOIN genres g ON g.slug = gq.genre_slug
       WHERE substr(gq.quarter, 1, 4) IN (?, ?) GROUP BY y, slug`,
      year, String(Number(year) - 1),
    );
    const total = (y: string) => tagRows.filter((r) => r.y === y).reduce((s, r) => s + r.tags, 0) || 1;
    const [tCur, tPrev] = [total(year), total(String(Number(year) - 1))];
    const shares = new Map<string, { slug: string; name: string; cur: number; prev: number }>();
    for (const r of tagRows) {
      const g = shares.get(r.slug) ?? { slug: r.slug, name: r.name, cur: 0, prev: 0 };
      if (r.y === year) g.cur = (100 * r.tags) / tCur; else g.prev = (100 * r.tags) / tPrev;
      shares.set(r.slug, g);
    }
    const genreShifts = [...shares.values()].filter((g) => g.cur >= 0.5 || g.prev >= 0.5).map((g) => ({ ...g, change: g.cur - g.prev }));
    const rising = [...genreShifts].sort((a, b) => b.change - a.change).filter((g) => g.change > 0).slice(0, 6);
    const falling = [...genreShifts].sort((a, b) => a.change - b.change).filter((g) => g.change < 0).slice(0, 6);
    const busiest = all<{ key: string; episodes: number }>(
      `SELECT ${SHOW_KEY} key, count(*) episodes FROM episodes e WHERE track_count > 0 AND broadcast_at >= ? AND broadcast_at < ?
       GROUP BY key ORDER BY episodes DESC LIMIT 20`,
      from, to,
    ).flatMap((r) => { const s = showRef(r.key); return s ? [{ ...s, episodes: r.episodes }] : []; }).slice(0, 12);
    return { stats, newcomers, climbers, rising, falling, busiest, hasPrevious: tPrev > 1 };
  });
}

// ---------- when things are played ----------

/** Broadcast times (UTC) of the dated episodes that played an artist or track, or of a show's episodes. */
export function playTimes(kind: "artist" | "track" | "show", key: number | string): string[] {
  const sql = {
    artist: "SELECT e.broadcast_at t FROM episode_artists ea JOIN episodes e ON e.rowid = ea.episode_id WHERE ea.artist_id = ?",
    track: `SELECT DISTINCT e.alias, e.broadcast_at t FROM plays p JOIN episodes e ON e.alias = p.episode_alias WHERE p.track_id = ? AND ${DATED}`,
    show: `SELECT e.broadcast_at t FROM episodes e WHERE ${SHOW_KEY} = ? AND e.track_count > 0 AND ${DATED}`,
  }[kind];
  return all<{ t: string }>(sql, key).map((r) => r.t);
}
