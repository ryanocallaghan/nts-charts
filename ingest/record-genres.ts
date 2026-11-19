// Look up tracks on Discogs and store their release's styles (track_discogs), most-played first:
// tracks played in at least 2 episodes, those played most in the last year first.
//   DISCOGS_TOKEN=... node ingest/record-genres.ts                  # everything due
//   DISCOGS_TOKEN=... node ingest/record-genres.ts --limit 30       # try a few
//   DISCOGS_TOKEN=... node ingest/record-genres.ts --max-minutes 60 # stop cleanly
// aggregate.ts turns the styles into genres (track_genres). Discogs allows 60 requests a minute with a
// personal token: https://www.discogs.com/developers
import { parseArgs } from "node:util";
import { openDb } from "./db.ts";
import { cleanTitle, discogsUrl, firstArtist, pickStyles, type DiscogsResult } from "./discogs.ts";

const TOKEN = process.env.DISCOGS_TOKEN;
if (!TOKEN) {
  console.error("Set DISCOGS_TOKEN (a Discogs personal access token).");
  process.exit(1);
}
const USER_AGENT = "TopOfTheNTS/0.1 +https://github.com/ryanocallaghan/nts-charts";
const FOUND_REFRESH_DAYS = 365;
// Discogs gets new records weeks or months after they come out, so look again sooner for recent ones.
const NOT_FOUND_RETRY_DAYS = { recent: 14, old: 90 };
const RECENT_DAYS = 180;

const { values: args } = parseArgs({ options: { limit: { type: "string" }, "max-minutes": { type: "string" } } });
const deadline = args["max-minutes"] ? Date.now() + Number(args["max-minutes"]) * 60_000 : Infinity;

const db = openDb();
const now = Date.now();
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();

const candidates = db.prepare(`
  SELECT p.track_id id, t.artist_display artist, t.title_display title, max(e.broadcast_at) last,
         count(DISTINCT p.episode_alias) episodes,
         count(DISTINCT CASE WHEN e.broadcast_at >= ? THEN p.episode_alias END) recent,
         d.checked_at checked, d.found
  FROM plays p JOIN episodes e ON e.alias = p.episode_alias JOIN tracks t ON t.id = p.track_id
  LEFT JOIN track_discogs d ON d.track_id = p.track_id
  WHERE e.broadcast_at IS NOT NULL
  GROUP BY p.track_id HAVING episodes >= 2
  ORDER BY recent DESC, episodes DESC, p.track_id`).all(ago(365)) as {
  id: number; artist: string; title: string; last: string; episodes: number; recent: number; checked: string | null; found: number | null;
}[];
const due = candidates.filter((c) => {
  if (!c.checked) return true;
  if (c.found) return c.checked < ago(FOUND_REFRESH_DAYS);
  return c.checked < ago(c.last >= ago(RECENT_DAYS) ? NOT_FOUND_RETRY_DAYS.recent : NOT_FOUND_RETRY_DAYS.old);
});
const todo = args.limit ? due.slice(0, Number(args.limit)) : due;
console.log(`${candidates.length} tracks in 2+ episodes; ${due.length} due; doing up to ${todo.length}`);

// ---------- requests: at most 1 a second, slower when Discogs says the minute's allowance is nearly used ----------

let next = 0;
let requests = 0;
async function search(type: "master" | "release", artist: string, track: string): Promise<DiscogsResult[]> {
  const url = `https://api.discogs.com/database/search?type=${type}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&per_page=10`;
  for (let attempt = 1; ; attempt++) {
    const wait = next - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    next = Date.now() + 1050;
    requests++;
    const res = await fetch(url, { headers: { authorization: `Discogs token=${TOKEN}`, "user-agent": USER_AGENT } });
    if (Number(res.headers.get("x-discogs-ratelimit-remaining") ?? 60) <= 2) next = Date.now() + 10_000;
    if (res.ok) return ((await res.json()) as { results?: DiscogsResult[] }).results ?? [];
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, res.status === 429 ? 60_000 : 5000 * attempt));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

const save = db.prepare(`
  INSERT INTO track_discogs(track_id, checked_at, found, url, release, year, styles_json, genres_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(track_id) DO UPDATE SET checked_at = excluded.checked_at, found = excluded.found, url = excluded.url,
    release = excluded.release, year = excluded.year, styles_json = excluded.styles_json, genres_json = excluded.genres_json`);

let done = 0, found = 0, errors = 0, consecutiveErrors = 0;
const started = Date.now();
for (const t of todo) {
  if (Date.now() > deadline || consecutiveErrors >= 20) break;
  const artist = firstArtist(t.artist);
  const title = cleanTitle(t.title);
  try {
    // A master groups a record's versions, so it's tried first; small releases often have none.
    let pick = pickStyles(await search("master", artist, title), artist, title);
    if (!pick) pick = pickStyles(await search("release", artist, title), artist, title);
    const checked = new Date().toISOString();
    if (pick) {
      const year = Number(pick.result.year) || null;
      save.run(t.id, checked, 1, discogsUrl(pick.result), pick.result.title, year, JSON.stringify(pick.styles), JSON.stringify(pick.genres));
      found++;
    } else {
      save.run(t.id, checked, 0, null, null, null, null, null);
    }
    consecutiveErrors = 0;
  } catch (err) {
    errors++;
    consecutiveErrors++;
    console.warn(`  ${t.artist} – ${t.title}: ${(err as Error).message}`);
  }
  if (++done % 250 === 0) console.log(`  ${done}/${todo.length}  found ${found}  (requests: ${requests})`);
}

const mins = (Date.now() - started) / 60_000;
console.log(`Done ${done} in ${mins.toFixed(1)} min: found ${found}, errors ${errors}, requests ${requests}`);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
if (consecutiveErrors >= 20) {
  console.error("Stopping: 20 errors in a row (is Discogs down, or the token wrong?)");
  process.exit(1);
}
