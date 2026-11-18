// Regular update (runs twice a day in CI):
//  1. page /collections/recently-added until we reach episodes we already have tracklists for
//  2. re-fetch tracklists for recent episodes that came back empty (NTS fills them in late)
//   node ingest/incremental.ts [--max-pages 20]
import { parseArgs } from "node:util";
import { getJson, pool, requestCount, type ApiEpisode, type ApiShow, type ApiTrack, type Page } from "./client.ts";
import { openDb, setMeta, tx } from "./db.ts";
import { saveTracklist, upsertEpisode, upsertShow } from "./store.ts";

const { values: args } = parseArgs({
  options: {
    "max-pages": { type: "string", default: "20" }, // API refuses offsets past ~234 anyway
    "recheck-days": { type: "string", default: "14" },
  },
});
const maxPages = Number(args["max-pages"]);
const recheckSince = new Date(Date.now() - Number(args["recheck-days"]) * 86_400_000).toISOString();

const db = openDb();
const known = db.prepare("SELECT tracklist_fetched_at FROM episodes WHERE alias = ?");

// 1. New episodes.
const fresh: ApiEpisode[] = [];
let overlap = 0;
for (let page = 0; page < maxPages; page++) {
  const res = await getJson<Page<ApiEpisode>>(`collections/recently-added?offset=${page * 12}&limit=12`);
  if (!res?.results?.length) break;
  for (const e of res.results) {
    const row = known.get(e.episode_alias) as { tracklist_fetched_at: string | null } | undefined;
    if (row?.tracklist_fetched_at) overlap++;
    else fresh.push(e);
  }
  if (overlap >= 24) break; // two pages' worth of already-known episodes: we've caught up
}
tx(db, () => fresh.forEach((e) => upsertEpisode(db, e)));
console.log(`New episodes: ${fresh.length}`);

// 2. Tracklists for new episodes + recent empty ones.
const todo = db
  .prepare(
    `SELECT alias, show_alias FROM episodes
     WHERE broadcast_at < ? AND (tracklist_fetched_at IS NULL OR (track_count = 0 AND broadcast_at > ?))`,
  )
  .all(new Date().toISOString(), recheckSince) as { alias: string; show_alias: string }[];
console.log(`Fetching ${todo.length} tracklists…`);
let filled = 0;
await pool(todo, 4, async (r) => {
  try {
    const tl = await getJson<Page<ApiTrack>>(`shows/${r.show_alias}/episodes/${r.alias}/tracklist`);
    saveTracklist(db, r.alias, tl?.results ?? []);
    if (tl?.results?.length) filled++;
  } catch (err) {
    console.warn(`  ! ${r.alias}: ${err instanceof Error ? err.message : err}`);
  }
});
console.log(`Tracklists with tracks: ${filled}/${todo.length}`);

// 3. Details for shows we only know by alias (new shows, or ones first seen via an episode).
const unnamed = (db.prepare("SELECT alias FROM shows WHERE name IS NULL").all() as { alias: string }[]).map((r) => r.alias);
await pool(unnamed, 4, async (alias) => {
  try {
    const show = await getJson<ApiShow>(`shows/${alias}`);
    if (show) upsertShow(db, show);
  } catch (err) {
    console.warn(`  ! show ${alias}: ${err instanceof Error ? err.message : err}`);
  }
});
console.log(`Show details fetched: ${unnamed.length}  (requests: ${requestCount})`);
setMeta(db, "incremental_at", new Date().toISOString());
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
