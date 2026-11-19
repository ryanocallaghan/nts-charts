// Match artists with pre-built pages to MusicBrainz, and store facts, links and a Wikipedia intro.
//   node ingest/enrich.ts                     # everything due (new, or older than the refresh age)
//   node ingest/enrich.ts --limit 30          # try a few
//   node ingest/enrich.ts --max-minutes 300   # stop cleanly before a CI job limit
// MusicBrainz asks for at most 1 request per second and an identifying User-Agent:
// https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PAGE_ARTISTS_PARAMS, PAGE_ARTISTS_SQL } from "../src/lib/artist-pages.ts";
import { pool } from "./client.ts";
import { openDb } from "./db.ts";
import { acceptSearch, cleanAnnotation, facts, matchCredit, pickLinks, trimBio, type MbArtist, type MbRecording, type MbSearchArtist } from "./musicbrainz.ts";

const USER_AGENT = "TopOfTheNTS/0.1 ( https://github.com/ryanocallaghan/nts-charts )";
const MATCHED_REFRESH_DAYS = 30;
const UNMATCHED_RETRY_DAYS = 60;

const { values: args } = parseArgs({
  options: { limit: { type: "string" }, "max-minutes": { type: "string" } },
});
const deadline = args["max-minutes"] ? Date.now() + Number(args["max-minutes"]) * 60_000 : Infinity;

// ---------- polite HTTP: one queue per host group ----------

function throttle(minGapMs: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + minGapMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
  };
}
const mbSlot = throttle(1100);   // MusicBrainz: ≤ 1 request per second
const wikiSlot = throttle(500);  // Wikidata + Wikipedia: gentle, and in parallel with MusicBrainz
let requests = 0;

async function getJson<T>(url: string, slot: () => Promise<void>, tries = 4): Promise<T | null> {
  for (let attempt = 1; ; attempt++) {
    await slot();
    requests++;
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 503 || res.status === 429 || res.status >= 500) && attempt < tries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const MB = "https://musicbrainz.org/ws/2";
const mb = <T>(path: string) => getJson<T>(`${MB}${path}${path.includes("?") ? "&" : "?"}fmt=json`, mbSlot);

// ---------- which artists are due ----------

const db = openDb();
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const paged = db.prepare(PAGE_ARTISTS_SQL).all(...PAGE_ARTISTS_PARAMS) as { id: number }[];
const info = new Map(
  (db.prepare("SELECT artist_id, mbid, checked_at FROM artist_info").all() as { artist_id: number; mbid: string | null; checked_at: string }[])
    .map((r) => [r.artist_id, r]),
);
const due = paged
  .map((p) => p.id)
  .filter((id) => {
    const r = info.get(id);
    if (!r) return true;
    return r.checked_at < ago(r.mbid ? MATCHED_REFRESH_DAYS : UNMATCHED_RETRY_DAYS);
  });
const todo = args.limit ? due.slice(0, Number(args.limit)) : due;
console.log(`${paged.length} artists with pages; ${due.length} due; doing ${todo.length}`);

const nameOf = db.prepare("SELECT name FROM artists WHERE id = ?");
const isrcsOf = db.prepare(`
  SELECT t.isrc FROM track_artists ta JOIN tracks t ON t.id = ta.track_id JOIN plays p ON p.track_id = t.id
  WHERE ta.artist_id = ? AND t.isrc IS NOT NULL GROUP BY t.isrc ORDER BY count(*) DESC LIMIT 3`);
const save = db.prepare(`
  INSERT INTO artist_info (artist_id, mbid, method, checked_at, type, area, begin_year, end_year, disambiguation, bio, bio_source, bio_url, links_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(artist_id) DO UPDATE SET mbid = excluded.mbid, method = excluded.method, checked_at = excluded.checked_at,
    type = excluded.type, area = excluded.area, begin_year = excluded.begin_year, end_year = excluded.end_year,
    disambiguation = excluded.disambiguation, bio = excluded.bio, bio_source = excluded.bio_source, bio_url = excluded.bio_url, links_json = excluded.links_json`);

// ---------- one artist ----------

async function findMbid(id: number, name: string): Promise<{ mbid: string; method: "isrc" | "name" } | null> {
  for (const { isrc } of isrcsOf.all(id) as { isrc: string }[]) {
    const r = await mb<{ recordings?: MbRecording[] }>(`/isrc/${encodeURIComponent(isrc)}?inc=artist-credits`);
    const mbid = r?.recordings ? matchCredit(r.recordings, name) : null;
    if (mbid) return { mbid, method: "isrc" };
  }
  const n = name.replace(/"/g, "");
  const q = encodeURIComponent(`artist:"${n}" OR alias:"${n}"`);
  const s = await mb<{ artists?: MbSearchArtist[] }>(`/artist?query=${q}&limit=10`);
  const mbid = s?.artists ? acceptSearch(s.artists, name) : null;
  return mbid ? { mbid, method: "name" } : null;
}

async function wikipediaIntro(qid: string): Promise<{ bio: string; url: string } | null> {
  const wd = await getJson<{ entities?: Record<string, { sitelinks?: { enwiki?: { title: string } } }> }>(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, wikiSlot,
  );
  const title = wd?.entities?.[qid]?.sitelinks?.enwiki?.title;
  if (!title) return null;
  const s = await getJson<{ type?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, wikiSlot,
  );
  if (!s?.extract || s.type === "disambiguation") return null;
  return { bio: trimBio(s.extract), url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
}

let done = 0, matched = 0, errors = 0, consecutiveErrors = 0;
const counts = { isrc: 0, name: 0, wikipedia: 0, annotation: 0, bandcamp: 0, instagram: 0, discogs: 0 };

async function enrich(id: number) {
  if (Date.now() > deadline || consecutiveErrors >= 20) return;
  const { name } = nameOf.get(id) as { name: string };
  try {
    const found = await findMbid(id, name);
    const checked = new Date().toISOString();
    if (!found) {
      save.run(id, null, "none", checked, null, null, null, null, null, null, null, null, null);
    } else {
      const a = await mb<MbArtist>(`/artist/${found.mbid}?inc=url-rels+annotation`);
      if (!a) throw new Error(`artist ${found.mbid} vanished`);
      const f = facts(a);
      const { links, wikidata } = pickLinks(a.relations);
      // Bio: Wikipedia's intro first; otherwise the MusicBrainz annotation (editor-written, CC BY-NC-SA).
      const wiki = wikidata ? await wikipediaIntro(wikidata) : null;
      const note = !wiki && a.annotation ? trimBio(cleanAnnotation(a.annotation)) : "";
      const bio = wiki
        ? { text: wiki.bio, source: "wikipedia", url: wiki.url }
        : note.length >= 40 ? { text: note, source: "musicbrainz", url: `https://musicbrainz.org/artist/${found.mbid}` } : null;
      save.run(id, found.mbid, found.method, checked, f.type, f.area, f.begin_year, f.end_year, f.disambiguation,
        bio?.text ?? null, bio?.source ?? null, bio?.url ?? null, Object.keys(links).length ? JSON.stringify(links) : null);
      matched++;
      counts[found.method]++;
      if (bio) counts[bio.source === "wikipedia" ? "wikipedia" : "annotation"]++;
      for (const k of ["bandcamp", "instagram", "discogs"] as const) if (links[k]) counts[k]++;
    }
    consecutiveErrors = 0;
  } catch (err) {
    errors++;
    consecutiveErrors++;
    console.warn(`  ${name}: ${(err as Error).message}`);
  }
  if (++done % 100 === 0) console.log(`  ${done}/${todo.length}  matched ${matched}  (requests: ${requests})`);
}

const started = Date.now();
// A few artists in flight at once: MusicBrainz calls still queue at 1/s, Wikipedia calls overlap them.
await pool(todo, 3, (id) => enrich(id));

// Errored artists weren't saved, so they stay due. If nothing was saved at all, don't ask to chain again.
const saved = done - errors;
const remaining = saved > 0 ? Math.max(0, due.length - saved) : 0;
const rate = requests / Math.max(1, (Date.now() - started) / 1000);
console.log(`Done ${done} in ${((Date.now() - started) / 60_000).toFixed(1)} min: matched ${matched}`, counts, `errors ${errors}, requests ${requests} (${rate.toFixed(2)}/s overall)`);
console.log(`Remaining work items: ${remaining}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `remaining=${remaining}\n`);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
if (consecutiveErrors >= 20) {
  console.error("Stopping: 20 errors in a row (is MusicBrainz down?)");
  process.exit(1);
}
