// One-off, resumable crawl of the whole NTS archive.
//   node ingest/backfill.ts                      # everything (sitemap → show listings → episode meta → tracklists)
//   node ingest/backfill.ts --shows helm,dj-swisha
//   node ingest/backfill.ts --phase tracklists --limit 500
//   node ingest/backfill.ts --max-minutes 300    # stop cleanly before a CI job limit
// Progress is committed per item; re-running skips work already done.
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getJson, pool, requestCount, type ApiEpisode, type ApiShow, type ApiTrack, type Page } from "./client.ts";
import { openDb, setMeta, tx } from "./db.ts";
import { readSitemap } from "./sitemap.ts";
import { insertEpisodeStub, insertShowStub, saveTracklist, upsertEpisode, upsertShow } from "./store.ts";

const { values: args } = parseArgs({
  options: {
    shows: { type: "string" },
    phase: { type: "string", default: "all" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "4" },
    "max-minutes": { type: "string" },
  },
});
const deadline = args["max-minutes"] ? Date.now() + Number(args["max-minutes"]) * 60_000 : Infinity;
const onlyShows = args.shows?.split(",").map((s) => s.trim()).filter(Boolean);
const limit = args.limit ? Number(args.limit) : Infinity;
const concurrency = Number(args.concurrency);
const phase = (p: string) => args.phase === "all" || args.phase === p;

const db = openDb();
const showFilter = onlyShows ? `AND show_alias IN (${onlyShows.map(() => "?").join(",")})` : "";
const showParams = onlyShows ?? [];

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log("\nStopping after in-flight requests… (Ctrl-C again to force)");
});

/** True once interrupted, out of time, or failing repeatedly. */
function shouldStop(): boolean {
  if (!stopping && Date.now() > deadline) {
    stopping = true;
    console.log("Time budget reached — stopping cleanly.");
  }
  return stopping;
}

// One bad item shouldn't kill a multi-hour run, but a block/outage should stop it fast.
let consecutiveErrors = 0;
let totalErrors = 0;
async function guarded(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    consecutiveErrors = 0;
  } catch (err) {
    totalErrors++;
    console.warn(`  ! ${label}: ${err instanceof Error ? err.message : err}`);
    if (++consecutiveErrors >= 20 && !stopping) {
      stopping = true;
      process.exitCode = 1;
      console.error("20 consecutive errors — stopping (rate-limited or blocked?).");
    }
  }
}

function progress(label: string, total: number) {
  const start = Date.now();
  let done = 0;
  return () => {
    done++;
    if (done % 100 === 0 || done === total) {
      const rate = done / ((Date.now() - start) / 1000);
      const eta = (total - done) / rate;
      console.log(`  ${label}: ${done}/${total}  ${rate.toFixed(1)}/s  ETA ${(eta / 60).toFixed(0)} min  (requests: ${requestCount})`);
    }
  };
}

// 1. Discover every show + episode from the sitemap.
if (phase("sitemap") && !onlyShows) {
  console.log("Reading sitemap…");
  const sm = await readSitemap();
  tx(db, () => {
    sm.shows.forEach((s) => insertShowStub(db, s));
    sm.episodes.forEach((e) => insertEpisodeStub(db, e.show, e.episode));
  });
  setMeta(db, "sitemap_read_at", new Date().toISOString());
  console.log(`  ${sm.shows.length} shows, ${sm.episodes.length} episodes`);
}
if (onlyShows) tx(db, () => onlyShows.forEach((s) => insertShowStub(db, s)));

// 2. Show metadata + paged episode listings (12 per call; API refuses offsets past ~1000).
if (phase("shows")) {
  const shows = (
    onlyShows ??
    (db.prepare("SELECT alias FROM shows WHERE episodes_listed_at IS NULL").all() as { alias: string }[]).map((r) => r.alias)
  ).slice(0, limit);
  console.log(`Listing episodes for ${shows.length} shows…`);
  const tick = progress("shows", shows.length);
  await pool(shows, concurrency, (alias) => guarded(`show ${alias}`, async () => {
    if (shouldStop()) return;
    const show = await getJson<ApiShow>(`shows/${alias}`);
    if (show) upsertShow(db, show);
    let complete = false;
    for (let offset = 0; !shouldStop(); offset += 12) {
      const page = await getJson<Page<ApiEpisode>>(`shows/${alias}/episodes?offset=${offset}&limit=12`);
      if (!page?.results?.length) { complete = true; break; }
      tx(db, () => page.results.forEach((e) => upsertEpisode(db, e)));
      const count = page.metadata?.resultset?.count ?? 0;
      if (offset + 12 >= count) { complete = true; break; }
    }
    if (complete) db.prepare("UPDATE shows SET episodes_listed_at = ? WHERE alias = ?").run(new Date().toISOString(), alias);
    tick();
  }));
}

// 3. Episodes the listings couldn't reach (shows with >1000 episodes, e.g. "guests").
if (phase("meta") && !stopping) {
  const rows = db
    .prepare(`SELECT alias, show_alias FROM episodes WHERE meta_fetched_at IS NULL ${showFilter} LIMIT ?`)
    .all(...showParams, Number.isFinite(limit) ? limit : -1) as { alias: string; show_alias: string }[];
  console.log(`Fetching metadata for ${rows.length} unlisted episodes…`);
  const tick = progress("meta", rows.length);
  await pool(rows, concurrency, (r) => guarded(`meta ${r.alias}`, async () => {
    if (shouldStop()) return;
    const ep = await getJson<ApiEpisode>(`shows/${r.show_alias}/episodes/${r.alias}`);
    if (ep) upsertEpisode(db, ep);
    else db.prepare("UPDATE episodes SET meta_fetched_at = ?, tracklist_fetched_at = ?, track_count = 0 WHERE alias = ?")
      .run("missing", "missing", r.alias); // 404 — don't retry forever
    tick();
  }));
}

// 4. Tracklists for every broadcast episode.
if (phase("tracklists") && !stopping) {
  const rows = db
    .prepare(
      `SELECT alias, show_alias FROM episodes
       WHERE tracklist_fetched_at IS NULL AND broadcast_at IS NOT NULL AND broadcast_at < ? ${showFilter}
       ORDER BY broadcast_at DESC LIMIT ?`,
    )
    .all(new Date().toISOString(), ...showParams, Number.isFinite(limit) ? limit : -1) as { alias: string; show_alias: string }[];
  console.log(`Fetching ${rows.length} tracklists…`);
  const tick = progress("tracklists", rows.length);
  await pool(rows, concurrency, (r) => guarded(`tracklist ${r.alias}`, async () => {
    if (shouldStop()) return;
    const tl = await getJson<Page<ApiTrack>>(`shows/${r.show_alias}/episodes/${r.alias}/tracklist`);
    saveTracklist(db, r.alias, tl?.results ?? []);
    tick();
  }));
}

// Work left for a future run (CI uses this to decide whether to chain another chunk).
const { remaining } = db
  .prepare(
    `SELECT (SELECT count(*) FROM shows WHERE episodes_listed_at IS NULL)
          + (SELECT count(*) FROM episodes WHERE meta_fetched_at IS NULL)
          + (SELECT count(*) FROM episodes WHERE tracklist_fetched_at IS NULL AND broadcast_at < ?) AS remaining`,
  )
  .get(new Date().toISOString()) as { remaining: number };
console.log(`Remaining work items: ${remaining}  (errors this run: ${totalErrors})`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `remaining=${remaining}\n`);

const stats = db
  .prepare(
    `SELECT (SELECT count(*) FROM shows) shows, (SELECT count(*) FROM episodes) episodes,
            (SELECT count(*) FROM episodes WHERE tracklist_fetched_at IS NOT NULL) with_tracklist,
            (SELECT count(*) FROM plays) plays, (SELECT count(*) FROM tracks) tracks, (SELECT count(*) FROM artists) artists`,
  )
  .get();
console.log("Done.", stats, `requests: ${requestCount}`);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); // fold the WAL into the main file before it's uploaded
db.close();
