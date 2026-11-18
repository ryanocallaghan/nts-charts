import type { DatabaseSync } from "node:sqlite";
import type { ApiEpisode, ApiShow, ApiTrack } from "./client.ts";
import { tx } from "./db.ts";
import { isPlaceholder, normText, slugify, splitArtists, trackKey } from "./normalize.ts";

const tags = (t?: { value: string }[]) => JSON.stringify((t ?? []).map((x) => x.value));
const now = () => new Date().toISOString();

export function upsertShow(db: DatabaseSync, s: ApiShow) {
  db.prepare(
    `INSERT INTO shows(alias, name, location, genres_json, image_url, updated) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(alias) DO UPDATE SET name = excluded.name, location = excluded.location,
       genres_json = excluded.genres_json, image_url = excluded.image_url, updated = excluded.updated`,
  ).run(s.show_alias, s.name, s.location_long ?? null, tags(s.genres), s.media?.picture_medium ?? null, s.updated ?? null);
}

export function insertShowStub(db: DatabaseSync, alias: string) {
  db.prepare("INSERT OR IGNORE INTO shows(alias) VALUES (?)").run(alias);
}

export function insertEpisodeStub(db: DatabaseSync, show: string, episode: string) {
  db.prepare("INSERT OR IGNORE INTO episodes(alias, show_alias) VALUES (?, ?)").run(episode, show);
}

export function upsertEpisode(db: DatabaseSync, e: ApiEpisode) {
  insertShowStub(db, e.show_alias);
  db.prepare(
    `INSERT INTO episodes(alias, show_alias, name, broadcast_at, genres_json, moods_json, location, image_url, meta_fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(alias) DO UPDATE SET show_alias = excluded.show_alias, name = excluded.name,
       broadcast_at = excluded.broadcast_at, genres_json = excluded.genres_json, moods_json = excluded.moods_json,
       location = excluded.location, image_url = excluded.image_url, meta_fetched_at = excluded.meta_fetched_at`,
  ).run(
    e.episode_alias, e.show_alias, e.name, new Date(e.broadcast).toISOString(), tags(e.genres), tags(e.moods),
    e.location_long ?? null, e.media?.picture_medium ?? null, now(),
  );
}

function resolveArtist(db: DatabaseSync, name: string): number {
  const norm = normText(name);
  const hit = db.prepare("SELECT id FROM artists WHERE norm_name = ?").get(norm) as { id: number } | undefined;
  if (hit) return hit.id;
  const base = slugify(name);
  let slug = base;
  for (let n = 2; !slug || db.prepare("SELECT 1 FROM artists WHERE slug = ?").get(slug); n++) {
    slug = base ? `${base}-${n}` : `artist-${Date.now().toString(36)}-${n}`;
  }
  const r = db.prepare("INSERT INTO artists(norm_name, name, slug) VALUES (?, ?, ?)").run(norm, name.trim(), slug);
  return Number(r.lastInsertRowid);
}

/** Find or create a track: by text key first (merges remasters/reissues), then by ISRC (merges spelling variants). */
export function resolveTrack(db: DatabaseSync, t: ApiTrack): number | null {
  const artist = t.artist?.trim();
  const title = t.title?.trim();
  if (!artist || !title || isPlaceholder(artist, title)) return null;
  const key = trackKey(artist, title);
  const isrc = t.isrc_id?.trim().toUpperCase() || null;

  let hit = db.prepare("SELECT id, isrc FROM tracks WHERE norm_key = ?").get(key) as { id: number; isrc: string | null } | undefined;
  if (!hit && isrc) hit = db.prepare("SELECT id, isrc FROM tracks WHERE isrc = ?").get(isrc) as typeof hit;
  if (hit) {
    if (!hit.isrc && isrc) db.prepare("UPDATE tracks SET isrc = ?, deezer_id = coalesce(deezer_id, ?) WHERE id = ?").run(isrc, t.deezer_track_id, hit.id);
    return hit.id;
  }

  const r = db
    .prepare("INSERT INTO tracks(norm_key, isrc, deezer_id, artist_display, title_display) VALUES (?, ?, ?, ?, ?)")
    .run(key, isrc, t.deezer_track_id, artist, title);
  const trackId = Number(r.lastInsertRowid);
  const { main, featured } = splitArtists(artist, title);
  const link = db.prepare("INSERT OR IGNORE INTO track_artists(track_id, artist_id) VALUES (?, ?)");
  for (const name of [...main, ...featured]) link.run(trackId, resolveArtist(db, name));
  return trackId;
}

/** Replace an episode's plays with a freshly fetched tracklist. */
export function saveTracklist(db: DatabaseSync, episodeAlias: string, tracks: ApiTrack[]) {
  tx(db, () => {
    db.prepare("DELETE FROM plays WHERE episode_alias = ?").run(episodeAlias);
    const ins = db.prepare("INSERT INTO plays(episode_alias, position, track_id, offset_s) VALUES (?, ?, ?, ?)");
    let count = 0;
    tracks.forEach((t, i) => {
      const id = resolveTrack(db, t);
      if (id == null) return;
      ins.run(episodeAlias, i, id, t.offset ?? t.offset_estimate ?? null);
      count++;
    });
    db.prepare("UPDATE episodes SET tracklist_fetched_at = ?, track_count = ? WHERE alias = ?").run(now(), count, episodeAlias);
  });
}
