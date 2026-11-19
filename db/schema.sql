PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shows (
  alias          TEXT PRIMARY KEY,
  name           TEXT,
  location       TEXT,
  genres_json    TEXT,
  image_url      TEXT,
  updated        TEXT,
  episodes_listed_at TEXT          -- when we last paged /shows/{alias}/episodes
);

CREATE TABLE IF NOT EXISTS episodes (
  alias                TEXT PRIMARY KEY,
  show_alias           TEXT NOT NULL,
  name                 TEXT,
  broadcast_at         TEXT,       -- ISO 8601 UTC
  genres_json          TEXT,
  moods_json           TEXT,
  location             TEXT,
  image_url            TEXT,
  meta_fetched_at      TEXT,
  tracklist_fetched_at TEXT,
  track_count          INTEGER,
  guest_slug           TEXT        -- for the catch-all 'guests' show: the guest, from the episode name (set by aggregate.ts)
);
CREATE INDEX IF NOT EXISTS episodes_broadcast ON episodes(broadcast_at);
CREATE INDEX IF NOT EXISTS episodes_show ON episodes(show_alias);
CREATE INDEX IF NOT EXISTS episodes_pending_tl ON episodes(tracklist_fetched_at) WHERE tracklist_fetched_at IS NULL;

CREATE TABLE IF NOT EXISTS tracks (
  id             INTEGER PRIMARY KEY,
  norm_key       TEXT NOT NULL UNIQUE,
  isrc           TEXT,
  deezer_id      INTEGER,
  artist_display TEXT NOT NULL,
  title_display  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tracks_isrc ON tracks(isrc) WHERE isrc IS NOT NULL;

CREATE TABLE IF NOT EXISTS artists (
  id        INTEGER PRIMARY KEY,
  norm_name TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS track_artists (
  track_id  INTEGER NOT NULL REFERENCES tracks(id),
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  PRIMARY KEY (track_id, artist_id)
);
CREATE INDEX IF NOT EXISTS track_artists_artist ON track_artists(artist_id);

CREATE TABLE IF NOT EXISTS plays (
  episode_alias TEXT NOT NULL REFERENCES episodes(alias),
  position      INTEGER NOT NULL,
  track_id      INTEGER NOT NULL REFERENCES tracks(id),
  offset_s      INTEGER,
  PRIMARY KEY (episode_alias, position)
);
CREATE INDEX IF NOT EXISTS plays_track ON plays(track_id);

CREATE TABLE IF NOT EXISTS chart_entries (
  period_type    TEXT NOT NULL,    -- week | month | year
  period_key     TEXT NOT NULL,    -- 2026-W46 | 2026-11 | 2026
  entity_type    TEXT NOT NULL,    -- track | artist
  entity_id      INTEGER NOT NULL,
  rank           INTEGER NOT NULL,
  score          INTEGER NOT NULL, -- distinct episodes
  shows_count    INTEGER NOT NULL, -- distinct shows
  prev_rank      INTEGER,          -- rank in previous period of same type, NULL if absent
  status         TEXT NOT NULL,    -- up | down | same | new | reentry
  periods_on_chart INTEGER NOT NULL,
  PRIMARY KEY (period_type, period_key, entity_type, rank)
);
CREATE INDEX IF NOT EXISTS chart_entity ON chart_entries(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- A show's theme tune: a track that opens or closes most of its episodes (rebuilt by aggregate.ts).
-- Its plays on that show don't count towards charts. show_key is a show alias, or 'guests/<slug>'.
CREATE TABLE IF NOT EXISTS theme_tunes (
  show_key  TEXT NOT NULL,
  track_id  INTEGER NOT NULL,
  episodes  INTEGER NOT NULL,     -- episodes it opened or closed
  of_total  INTEGER NOT NULL,     -- the show's episodes with tracklists
  PRIMARY KEY (show_key, track_id)
);

-- MusicBrainz (+ Wikipedia) info for the most-played artists (filled by ingest/enrich.ts).
-- mbid NULL means "checked, no confident match" (retried after a while).
CREATE TABLE IF NOT EXISTS artist_info (
  artist_id       INTEGER PRIMARY KEY,
  mbid            TEXT,
  method          TEXT,        -- 'isrc' | 'name' | 'none'
  checked_at      TEXT NOT NULL,
  type            TEXT,        -- Person, Group, …
  area            TEXT,
  begin_year      INTEGER,
  end_year        INTEGER,
  disambiguation  TEXT,
  bio             TEXT,        -- short intro: Wikipedia extract (CC BY-SA) or MusicBrainz annotation (CC BY-NC-SA)
  bio_source      TEXT,        -- 'wikipedia' | 'musicbrainz'
  bio_url         TEXT,
  links_json      TEXT         -- {"bandcamp": url, "instagram": url, "discogs": url}
);

-- Site search over artists, shows and repeat guests (rebuilt by aggregate.ts). norm is searchNorm(name)
-- from src/lib/search.ts; queries match each word as a prefix. kind: artist | show | guest.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  norm, name UNINDEXED, kind UNINDEXED, key UNINDEXED, episodes UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);

-- Per-artist totals (rebuilt by aggregate.ts): episodes counts every dated episode; first_at ignores
-- symbolic pre-2011 dates. For "artists new to NTS" and, later, related-artist scores.
DROP TABLE IF EXISTS artist_firsts; -- replaced by artist_stats
CREATE TABLE IF NOT EXISTS artist_stats (
  artist_id INTEGER PRIMARY KEY,
  episodes  INTEGER NOT NULL,
  first_at  TEXT
);
CREATE INDEX IF NOT EXISTS artist_stats_first ON artist_stats(first_at);
