// SQL shared by the site (src/lib/queries.ts) and ingest (ingest/aggregate.ts, ingest/enrich.ts),
// so both always work on the same sets. No DB access here.
import { PERIOD_KEY_SQL, type PeriodType } from "../../ingest/charts.ts";
import { FIRST_VALID_DATE } from "./dates.ts";

/** A show, or for NTS's catch-all guests show, the individual guest (episodes alias e). */
export const SHOW_KEY = "coalesce('guests/' || e.guest_slug, e.show_alias)";

/** NTS's catch-all show for one-off guest mixes. Each guest counts as its own "show" (keyed 'guests/<slug>'). */
export const GUESTS_SHOW = "guests";

/**
 * Repeat guests, who get a page at /shows/guests/<slug>/: rows (slug, name, mixes, last), by name.
 * The name is taken from their latest mix.
 */
export const GUEST_PAGES_SQL = `
  SELECT guest_slug slug, count(*) mixes, max(broadcast_at) last,
         (SELECT trim(name) FROM episodes x WHERE x.guest_slug = e.guest_slug ORDER BY broadcast_at DESC LIMIT 1) name
  FROM episodes e WHERE guest_slug IS NOT NULL AND broadcast_at IS NOT NULL
  GROUP BY guest_slug HAVING mixes >= 2 AND sum(track_count > 0) > 0 ORDER BY name COLLATE NOCASE`;

// MusicBrainz enrichment (1 request a second) covers the most-played artists: those above this
// activity, at most ENRICH_LIMIT of them, plus anyone who has charted.
export const ENRICH_MIN_EPISODES = Number(process.env.ENRICH_MIN_EPISODES ?? 3);
export const ENRICH_MIN_SHOWS = Number(process.env.ENRICH_MIN_SHOWS ?? 2);
export const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT ?? 10000);

/** Rows (id, slug, episodes, shows) for artists to look up on MusicBrainz, most played first. Bind ENRICH_ARTISTS_PARAMS. */
export const ENRICH_ARTISTS_SQL = `
  SELECT a.id, a.slug, count(DISTINCT p.episode_alias) episodes, count(DISTINCT ${SHOW_KEY}) shows
  FROM track_artists ta
  JOIN plays p ON p.track_id = ta.track_id
  JOIN episodes e ON e.alias = p.episode_alias
  JOIN artists a ON a.id = ta.artist_id
  GROUP BY a.id
  HAVING (episodes >= ? AND shows >= ?)
      OR a.id IN (SELECT entity_id FROM chart_entries WHERE entity_type = 'artist')
  ORDER BY episodes DESC, shows DESC, a.id
  LIMIT ?`;
export const ENRICH_ARTISTS_PARAMS = [ENRICH_MIN_EPISODES, ENRICH_MIN_SHOWS, ENRICH_LIMIT] as const;

/** A Discogs style with no NTS tag becomes a genre once this many records have it. */
export const DISCOGS_GENRE_MIN_TRACKS = Number(process.env.DISCOGS_GENRE_MIN_TRACKS ?? 20);

// ---------- charts ----------

export const CHART_SIZE = Number(process.env.CHART_SIZE ?? 50);
export const ALL_TIME_CHART_SIZE = Number(process.env.ALL_TIME_CHART_SIZE ?? 100);
/** An item needs plays in this many distinct episodes to chart (filters one-off plays). */
export const CHART_MIN_SCORE = Number(process.env.CHART_MIN_SCORE ?? 2);

export interface RankOptions {
  /** Extra condition on episodes (columns of `episodes`, unqualified), e.g. a genre or a place. */
  where?: string;
  /** Only episodes broadcast in [start, end): bind the two ISO dates first. */
  range?: boolean;
  /** Only the period whose key is bound after any `where` parameters. */
  onePeriod?: boolean;
  /** Extra condition on the played track (`p.track_id`), e.g. a record genre; its params come after the period key. */
  trackWhere?: string;
}

/**
 * Rank tracks or artists by the distinct episodes that played them in each chart period. Ties: more
 * shows, then the most recent play. A show's theme tune doesn't count for that show. Rows:
 * (periodKey, entityId, rank, score, shows).
 * Bind, in order: [range start, range end], ...where params, [period key], ...trackWhere params, CHART_MIN_SCORE, size.
 * aggregate.ts ranks every period at once; the site ranks one period of a filtered chart.
 */
export function rankSql(periodType: PeriodType, entity: "track" | "artist", opts: RankOptions = {}): string {
  const join = entity === "track" ? "" : "JOIN track_artists ta ON ta.track_id = p.track_id";
  const id = entity === "track" ? "p.track_id" : "ta.artist_id";
  const rolling = periodType === "rolling";
  return `
    WITH ep AS (
      SELECT alias, coalesce('guests/' || guest_slug, show_alias) AS show_key, broadcast_at, ${PERIOD_KEY_SQL[periodType]} AS pk
      FROM episodes ${rolling ? ", (SELECT 0 k UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)" : ""}
      WHERE broadcast_at >= '${FIRST_VALID_DATE}'
        ${opts.range ? "AND broadcast_at >= ? AND broadcast_at < ?" : ""}
        ${opts.where ? `AND (${opts.where})` : ""}
        ${rolling && !opts.onePeriod ? "AND pk <= (SELECT max(strftime('%G-W%V', broadcast_at)) FROM episodes WHERE track_count > 0)" : ""}
    ),
    agg AS (
      SELECT ep.pk, ${id} AS eid,
             count(DISTINCT p.episode_alias) AS score,
             count(DISTINCT ep.show_key) AS shows,
             max(ep.broadcast_at) AS last_play
      FROM plays p JOIN ep ON ep.alias = p.episode_alias ${join}
      WHERE ${opts.onePeriod ? "ep.pk = ? AND " : ""}${opts.trackWhere ? `(${opts.trackWhere}) AND ` : ""}NOT EXISTS (SELECT 1 FROM theme_tunes tt WHERE tt.show_key = ep.show_key AND tt.track_id = p.track_id)
      GROUP BY ep.pk, ${id}
      HAVING score >= ?
    ),
    ranked AS (
      SELECT *, row_number() OVER (PARTITION BY pk ORDER BY score DESC, shows DESC, last_play DESC, eid) AS rk
      FROM agg
    )
    SELECT pk AS periodKey, eid AS entityId, rk AS rank, score, shows FROM ranked WHERE rk <= ?`;
}
