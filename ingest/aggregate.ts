// Rebuild chart_entries from plays. Cheap enough to recompute fully on every run.
//   node ingest/aggregate.ts
import { PERIOD_KEY_SQL, PERIOD_TYPES, withMovement, type PeriodType, type Ranked } from "./charts.ts";
import { openDb, setMeta, tx } from "./db.ts";
import { isPlaceholder } from "./normalize.ts";

const TOP_N = Number(process.env.CHART_SIZE ?? 50);
const TOP_N_ALL_TIME = Number(process.env.ALL_TIME_CHART_SIZE ?? 100);
// An item needs plays in this many distinct episodes to chart (filters one-off plays).
const MIN_SCORE = Number(process.env.CHART_MIN_SCORE ?? 2);

const db = openDb();
const started = Date.now();

// Prune placeholder tracks ("Unknown Artist – Unknown Track", "ID – ID") that were stored before the
// filter existed or under older rules, plus any artists left with no tracks.
tx(db, () => {
  const tracks = db.prepare("SELECT id, artist_display a, title_display t FROM tracks").all() as { id: number; a: string; t: string }[];
  const junk = tracks.filter((r) => isPlaceholder(r.a, r.t)).map((r) => r.id);
  for (const id of junk) {
    db.prepare("DELETE FROM plays WHERE track_id = ?").run(id);
    db.prepare("DELETE FROM track_artists WHERE track_id = ?").run(id);
    db.prepare("DELETE FROM tracks WHERE id = ?").run(id);
  }
  const orphans = db.prepare("DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM track_artists)").run().changes;
  if (junk.length || orphans) console.log(`  pruned ${junk.length} placeholder tracks, ${orphans} orphaned artists`);
});

// Distinct episodes / shows per (period, entity). Ties: more shows, then most recent play.
function ranked(periodType: PeriodType, entity: "track" | "artist"): Ranked[] {
  const join = entity === "track" ? "" : "JOIN track_artists ta ON ta.track_id = p.track_id";
  const id = entity === "track" ? "p.track_id" : "ta.artist_id";
  const sql = `
    WITH ep AS (
      SELECT alias, show_alias, broadcast_at, ${PERIOD_KEY_SQL[periodType]} AS pk
      FROM episodes ${periodType === "rolling" ? ", (SELECT 0 k UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)" : ""}
      WHERE broadcast_at IS NOT NULL
        ${periodType === "rolling" ? `AND pk <= (SELECT max(strftime('%G-W%V', broadcast_at)) FROM episodes WHERE track_count > 0)` : ""}
    ),
    agg AS (
      SELECT ep.pk, ${id} AS eid,
             count(DISTINCT p.episode_alias) AS score,
             count(DISTINCT ep.show_alias) AS shows,
             max(ep.broadcast_at) AS last_play
      FROM plays p JOIN ep ON ep.alias = p.episode_alias ${join}
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
setMeta(db, "aggregated_at", new Date().toISOString());
console.log(`Aggregated in ${((Date.now() - started) / 1000).toFixed(1)}s`);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
