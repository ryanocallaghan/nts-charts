// SQL shared by the site (src/lib/queries.ts) and ingest (ingest/aggregate.ts, ingest/enrich.ts),
// so both always work on the same sets. No DB access here.

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
