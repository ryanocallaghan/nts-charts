import { all, get } from "./db.ts";
import { PAGE_ARTISTS_PARAMS, PAGE_ARTISTS_SQL, SHOW_KEY } from "./artist-pages.ts";
import { ntsEpisodeUrl, rollingStartKey, type PeriodType } from "./format.ts";

// NTS files one-off guest mixes under one catch-all show. Each guest counts as its own "show"
// (keyed 'guests/<slug>'); guests with this many mixes get a page at /shows/guests/<slug>/.
export const GUESTS_SHOW = "guests";
const GUEST_PAGE_MIN_MIXES = 2;

export interface GuestRow { slug: string; name: string; mixes: number; last: string }
let guests: Map<string, GuestRow> | undefined;
/** Repeat guests (with pages), by slug. Name is taken from their latest mix. */
export function guestPages(): Map<string, GuestRow> {
  guests ??= new Map(
    all<GuestRow>(
      `SELECT guest_slug slug, count(*) mixes, max(broadcast_at) last,
              (SELECT trim(name) FROM episodes x WHERE x.guest_slug = e.guest_slug ORDER BY broadcast_at DESC LIMIT 1) name
       FROM episodes e WHERE guest_slug IS NOT NULL AND broadcast_at IS NOT NULL
       GROUP BY guest_slug HAVING mixes >= ? AND sum(track_count > 0) > 0 ORDER BY name COLLATE NOCASE`,
      GUEST_PAGE_MIN_MIXES,
    ).map((g) => [g.slug, g]),
  );
  return guests;
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

let pageArtists: Map<number, { slug: string; episodes: number }> | undefined;
function loadPageArtists() {
  pageArtists ??= new Map(
    all<{ id: number; slug: string; episodes: number }>(PAGE_ARTISTS_SQL, ...PAGE_ARTISTS_PARAMS).map((r) => [r.id, { slug: r.slug, episodes: r.episodes }]),
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
  const stats = get<{ episodes: number; shows: number; tracks: number; first: string; last: string }>(
    `SELECT count(DISTINCT p.episode_alias) episodes, count(DISTINCT ${SHOW_KEY}) shows,
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
  const shows = all<{ show: string; guest: string | null; showName: string; guestName: string | null; anyEpisode: string; episodes: number }>(
    `SELECT e.show_alias show, e.guest_slug guest, coalesce(s.name, e.show_alias) showName, max(e.name) guestName,
            max(e.alias) anyEpisode, count(DISTINCT p.episode_alias) episodes
     FROM ${ARTIST_PLAYS} LEFT JOIN shows s ON s.alias = e.show_alias
     WHERE ta.artist_id = ? GROUP BY ${SHOW_KEY} ORDER BY episodes DESC, showName LIMIT 25`,
    id,
  ).map((r) => ({ ...showLink(r), episodes: r.episodes }));
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

/** A show's page data, or a repeat guest's (their mixes on the catch-all guests show). */
export function showDetail(alias: string, guest?: string) {
  const [col, key] = guest ? ["guest_slug", guest] : ["show_alias", alias];
  const stats = get<{ episodes: number; plays: number; tracks: number; first: string; last: string }>(
    `SELECT count(DISTINCT e.alias) episodes, count(p.track_id) plays, count(DISTINCT p.track_id) tracks,
            min(e.broadcast_at) first, max(e.broadcast_at) last
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
  // A guest's page lists every mix (there are only a few), even ones without a tracklist.
  const episodes = all<{ alias: string; name: string; broadcast: string; trackCount: number; guest: string | null }>(
    `SELECT alias, trim(coalesce(name, alias)) name, broadcast_at broadcast, coalesce(track_count, 0) trackCount, guest_slug guest
     FROM episodes WHERE ${col} = ? AND broadcast_at IS NOT NULL ${guest ? "" : "AND track_count > 0"}
     ORDER BY broadcast_at DESC LIMIT 30`,
    key,
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
