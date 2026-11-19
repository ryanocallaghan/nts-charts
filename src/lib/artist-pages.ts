// Which artists get a pre-built page: shared by the site build (src/lib/queries.ts) and the
// MusicBrainz enrichment (ingest/enrich.ts), so both always work on the same set. No DB access here.

// Artists get their own page only above this activity (keeps the site under hosting file limits)...
export const ARTIST_MIN_EPISODES = Number(process.env.ARTIST_MIN_EPISODES ?? 3);
export const ARTIST_MIN_SHOWS = Number(process.env.ARTIST_MIN_SHOWS ?? 2);
// ...and at most this many (the most-played first). Cloudflare Pages allows 20,000 files per deploy;
// shows, charts and the data/search shards take roughly another 5,500. Every other artist gets a
// page rendered in the browser from a data shard (see src/pages/artists/404.astro).
export const ARTIST_PAGE_LIMIT = Number(process.env.ARTIST_PAGE_LIMIT ?? 10000);

/** A show, or for NTS's catch-all guests show, the individual guest (episodes alias e). */
export const SHOW_KEY = "coalesce('guests/' || e.guest_slug, e.show_alias)";

/** Rows (id, slug, episodes, shows) for artists with pages, most played first. Bind PAGE_ARTISTS_PARAMS. */
export const PAGE_ARTISTS_SQL = `
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
export const PAGE_ARTISTS_PARAMS = [ARTIST_MIN_EPISODES, ARTIST_MIN_SHOWS, ARTIST_PAGE_LIMIT] as const;
