// Rebuild chart_entries from plays. Cheap enough to recompute fully on every run.
//   node ingest/aggregate.ts
import { findThemeTunes, PERIOD_TYPES, withMovement, type PeriodType, type Ranked } from "./charts.ts";
import { openDb, setMeta, tx } from "./db.ts";
import { isPlaceholder, slugify } from "./normalize.ts";
import { FIRST_VALID_DATE } from "../src/lib/dates.ts";
import { searchNorm, trackKey } from "../src/lib/search.ts";
// NTS files one-off guest mixes under one catch-all show; each guest (from the episode name) counts as its own show.
import { ALL_TIME_CHART_SIZE, CHART_MIN_SCORE, CHART_SIZE, GUEST_PAGES_SQL, GUESTS_SHOW, rankSql } from "../src/lib/shared-sql.ts";


const db = openDb();
const started = Date.now();

// Prune placeholder tracks ("Unknown Artist – Unknown Track", "ID – ID") that were stored before the
// filter existed or under older rules, plus any artists left with no tracks.
tx(db, () => {
  // Streamed: holding all ~1M tracks at once took several hundred MB.
  const junk: number[] = [];
  for (const r of db.prepare("SELECT id, artist_display a, title_display t FROM tracks").iterate() as IterableIterator<{ id: number; a: string; t: string }>) {
    if (isPlaceholder(r.a, r.t)) junk.push(r.id);
  }
  for (const id of junk) {
    db.prepare("DELETE FROM plays WHERE track_id = ?").run(id);
    db.prepare("DELETE FROM track_artists WHERE track_id = ?").run(id);
    db.prepare("DELETE FROM tracks WHERE id = ?").run(id);
  }
  const orphans = db.prepare("DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM track_artists)").run().changes;
  if (junk.length || orphans) console.log(`  pruned ${junk.length} placeholder tracks, ${orphans} orphaned artists`);
});

// Name each guest mix's guest. Recomputed every run (a few thousand rows), so naming rules can change freely.
tx(db, () => {
  const set = db.prepare("UPDATE episodes SET guest_slug = ? WHERE alias = ?");
  const rows = db.prepare("SELECT alias, name, guest_slug FROM episodes WHERE show_alias = ?").all(GUESTS_SHOW) as { alias: string; name: string | null; guest_slug: string | null }[];
  let changed = 0;
  for (const r of rows) {
    const slug = (r.name && slugify(r.name.trim())) || null;
    if (slug !== r.guest_slug) { set.run(slug, r.alias); changed++; }
  }
  if (changed) console.log(`  named ${changed} guest mixes`);
});

// Theme tunes: a track that opens or closes most of a show's episodes doesn't count for that show.
tx(db, () => {
  const ends = db.prepare(`
    SELECT coalesce('guests/' || e.guest_slug, e.show_alias) show,
           (SELECT track_id FROM plays WHERE episode_alias = e.alias ORDER BY position LIMIT 1) first,
           (SELECT track_id FROM plays WHERE episode_alias = e.alias ORDER BY position DESC LIMIT 1) last
    FROM episodes e WHERE e.track_count > 0`).all() as { show: string; first: number | null; last: number | null }[];
  const themes = findThemeTunes(ends.filter((e) => e.first != null && e.last != null) as { show: string; first: number; last: number }[]);
  db.exec("DELETE FROM theme_tunes");
  const ins = db.prepare("INSERT INTO theme_tunes(show_key, track_id, episodes, of_total) VALUES (?, ?, ?, ?)");
  for (const t of themes) ins.run(t.show, t.trackId, t.episodes, t.ofTotal);
  console.log(`  ${themes.length} theme tunes`);
});

// Every period's chart for each type (see rankSql in src/lib/shared-sql.ts).
function ranked(periodType: PeriodType, entity: "track" | "artist"): Ranked[] {
  return db.prepare(rankSql(periodType, entity)).all(CHART_MIN_SCORE, periodType === "all" ? ALL_TIME_CHART_SIZE : CHART_SIZE) as unknown as Ranked[];
}

const ins = db.prepare(
  `INSERT INTO chart_entries(period_type, period_key, entity_type, entity_id, rank, score, shows_count, prev_rank, status, periods_on_chart)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

tx(db, () => {
  db.exec("DELETE FROM chart_entries");
  for (const periodType of PERIOD_TYPES) {
    for (const entity of ["track", "artist"] as const) {
      const rows = withMovement(ranked(periodType, entity));
      for (const r of rows) {
        ins.run(periodType, r.periodKey, entity, r.entityId, r.rank, r.score, r.shows, r.prevRank, r.status, r.periodsOnChart);
      }
      const periods = new Set(rows.map((r) => r.periodKey)).size;
      console.log(`  ${periodType}/${entity}: ${periods} charts, ${rows.length} entries`);
    }
  }
});
// Genres: NTS's tags on dated, tracklisted episodes, keyed by slug (tags vary in case and spacing,
// e.g. "Industrial " and "Industrial"). Each genre takes its most common spelling as its name.
tx(db, () => {
  db.exec("DELETE FROM episode_genres; DELETE FROM genres;");
  const tag = db.prepare("INSERT OR IGNORE INTO episode_genres(genre_slug, episode_alias) VALUES (?, ?)");
  const spellings = new Map<string, Map<string, number>>();
  for (const r of db.prepare(
    `SELECT alias, genres_json g FROM episodes
     WHERE track_count > 0 AND broadcast_at >= '${FIRST_VALID_DATE}' AND genres_json IS NOT NULL AND genres_json != '[]'`,
  ).iterate() as IterableIterator<{ alias: string; g: string }>) {
    for (const raw of JSON.parse(r.g) as string[]) {
      const name = String(raw).trim().replace(/\s+/g, " ");
      const slug = slugify(name);
      if (!slug) continue;
      tag.run(slug, r.alias);
      const counts = spellings.get(slug) ?? new Map<string, number>();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      spellings.set(slug, counts);
    }
  }
  const add = db.prepare("INSERT INTO genres(slug, name, episodes) VALUES (?, ?, (SELECT count(*) FROM episode_genres WHERE genre_slug = ?))");
  for (const [slug, counts] of spellings) add.run(slug, [...counts].sort((a, b) => b[1] - a[1])[0][0], slug);
  db.exec(`DELETE FROM genre_quarters;
    INSERT INTO genre_quarters(quarter, genre_slug, tags)
    SELECT strftime('%Y', e.broadcast_at) || '-Q' || ((CAST(strftime('%m', e.broadcast_at) AS INTEGER) + 2) / 3), eg.genre_slug, count(*)
    FROM episode_genres eg JOIN episodes e ON e.alias = eg.episode_alias GROUP BY 1, 2`);
  console.log(`  ${spellings.size} genres`);
});

// Per-artist totals.
tx(db, () => {
  db.exec("DELETE FROM artist_stats");
  db.exec(`INSERT INTO artist_stats(artist_id, episodes, first_at)
    SELECT ta.artist_id, count(DISTINCT p.episode_alias), min(CASE WHEN e.broadcast_at >= '${FIRST_VALID_DATE}' THEN e.broadcast_at END)
    FROM track_artists ta JOIN plays p ON p.track_id = ta.track_id JOIN episodes e ON e.alias = p.episode_alias
    WHERE e.broadcast_at IS NOT NULL GROUP BY ta.artist_id`);
});

// Search: every artist, show and repeat guest, and tracks played in two or more episodes, weighted by
// the episodes (mixes for guests) they're in.
tx(db, () => {
  db.exec("DELETE FROM search_index");
  const add = db.prepare("INSERT INTO search_index(norm, name, kind, key, episodes) VALUES (?, ?, ?, ?, ?)");
  let n = 0;
  const put = (name: string, kind: string, key: string, episodes: number, norm = searchNorm(name)) => {
    if (norm) { add.run(norm, name, kind, key, episodes); n++; }
  };
  for (const r of db.prepare("SELECT a.name, a.slug, s.episodes n FROM artist_stats s JOIN artists a ON a.id = s.artist_id").iterate() as IterableIterator<{ name: string; slug: string; n: number }>) {
    put(r.name, "artist", r.slug, r.n);
  }
  for (const r of db.prepare(
    `SELECT t.id, t.title_display title, t.artist_display artist, c.n FROM (
       SELECT p.track_id, count(DISTINCT p.episode_alias) n FROM plays p JOIN episodes e ON e.alias = p.episode_alias
       WHERE e.broadcast_at IS NOT NULL GROUP BY p.track_id HAVING n >= 2) c JOIN tracks t ON t.id = c.track_id`,
  ).iterate() as IterableIterator<{ id: number; title: string; artist: string; n: number }>) {
    put(`${r.title} — ${r.artist}`, "track", trackKey(r.id, r.artist, r.title), r.n);
  }
  for (const r of db.prepare(
    `SELECT s.alias, coalesce(s.name, s.alias) name, count(e.alias) n
     FROM shows s JOIN episodes e ON e.show_alias = s.alias WHERE e.track_count > 0 GROUP BY s.alias`,
  ).all() as { alias: string; name: string; n: number }[]) put(r.name, "show", r.alias, r.n);
  for (const r of db.prepare(GUEST_PAGES_SQL).all() as { slug: string; name: string; mixes: number }[]) put(r.name, "guest", r.slug, r.mixes);
  console.log(`  search: ${n} entries`);
});
db.exec("INSERT INTO search_index(search_index) VALUES ('optimize')");

setMeta(db, "aggregated_at", new Date().toISOString());
console.log(`Aggregated in ${((Date.now() - started) / 1000).toFixed(1)}s`);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
