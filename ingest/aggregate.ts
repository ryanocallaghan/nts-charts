// Rebuild chart_entries from plays. Cheap enough to recompute fully on every run.
//   node ingest/aggregate.ts
import { findThemeTunes, PERIOD_KEY_SQL, PERIOD_TYPES, withMovement, type PeriodType, type Ranked } from "./charts.ts";
import { openDb, setMeta, tx } from "./db.ts";
import { isPlaceholder, slugify } from "./normalize.ts";
import { FIRST_VALID_DATE } from "../src/lib/dates.ts";
import { searchNorm, trackKey } from "../src/lib/search.ts";
// NTS files one-off guest mixes under one catch-all show; each guest (from the episode name) counts as its own show.
import { GUEST_PAGES_SQL, GUESTS_SHOW } from "../src/lib/shared-sql.ts";

const TOP_N = Number(process.env.CHART_SIZE ?? 50);
const TOP_N_ALL_TIME = Number(process.env.ALL_TIME_CHART_SIZE ?? 100);
// An item needs plays in this many distinct episodes to chart (filters one-off plays).
const MIN_SCORE = Number(process.env.CHART_MIN_SCORE ?? 2);

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

// Distinct episodes / shows per (period, entity). Ties: more shows, then most recent play.
function ranked(periodType: PeriodType, entity: "track" | "artist"): Ranked[] {
  const join = entity === "track" ? "" : "JOIN track_artists ta ON ta.track_id = p.track_id";
  const id = entity === "track" ? "p.track_id" : "ta.artist_id";
  const sql = `
    WITH ep AS (
      SELECT alias, coalesce('guests/' || guest_slug, show_alias) AS show_key, broadcast_at, ${PERIOD_KEY_SQL[periodType]} AS pk
      FROM episodes ${periodType === "rolling" ? ", (SELECT 0 k UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)" : ""}
      WHERE broadcast_at >= '${FIRST_VALID_DATE}'
        ${periodType === "rolling" ? `AND pk <= (SELECT max(strftime('%G-W%V', broadcast_at)) FROM episodes WHERE track_count > 0)` : ""}
    ),
    agg AS (
      SELECT ep.pk, ${id} AS eid,
             count(DISTINCT p.episode_alias) AS score,
             count(DISTINCT ep.show_key) AS shows,
             max(ep.broadcast_at) AS last_play
      FROM plays p JOIN ep ON ep.alias = p.episode_alias ${join}
      WHERE NOT EXISTS (SELECT 1 FROM theme_tunes tt WHERE tt.show_key = ep.show_key AND tt.track_id = p.track_id)
      GROUP BY ep.pk, ${id}
      HAVING score >= ?
    ),
    ranked AS (
      SELECT *, row_number() OVER (PARTITION BY pk ORDER BY score DESC, shows DESC, last_play DESC, eid) AS rk
      FROM agg
    )
    SELECT pk AS periodKey, eid AS entityId, rk AS rank, score, shows FROM ranked WHERE rk <= ?`;
  return db.prepare(sql).all(MIN_SCORE, periodType === "all" ? TOP_N_ALL_TIME : TOP_N) as unknown as Ranked[];
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
