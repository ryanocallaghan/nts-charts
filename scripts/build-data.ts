// After `astro build`: write the data behind client-rendered artist pages and search.
//   dist/data/artists/<n>.json   artists without a pre-built page, split by slug hash (see src/lib/shard.ts)
//   dist/data/search/<key>.json  every artist and show, by word prefix; index.json lists split prefixes
//   dist/artists/404.html        the page Cloudflare serves for any /artists/<slug>/ without a pre-built page
// One streaming pass over all plays.
import { mkdirSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { all, get, iterate } from "../src/lib/db.ts";
import { artistsWithPages, guestPages } from "../src/lib/queries.ts";
import { ntsEpisodeUrl } from "../src/lib/format.ts";
import { ARTIST_SHARDS, artistShard, searchFile, searchKey, searchWords } from "../src/lib/shard.ts";
import type { ArtistShard, LongtailArtist, SearchEntry } from "../src/lib/longtail-types.ts";

const DIST = "dist";
const TRACKS_PER_ARTIST = 25;
const EPISODES_PER_TRACK = 10;
const SHOWS_PER_ARTIST = 15;
const SPLIT_AT = 3000; // entries in a two-letter search file before it's split by third letter

const started = Date.now();
const paged = artistsWithPages();

const episodes = new Map<string, { show: string; guest: string | null; date: string; name: string }>();
for (const r of all<{ alias: string; show: string; guest: string | null; date: string; name: string | null }>(
  "SELECT alias, show_alias show, guest_slug guest, substr(broadcast_at, 1, 10) date, name FROM episodes WHERE broadcast_at IS NOT NULL",
)) episodes.set(r.alias, { show: r.show, guest: r.guest, date: r.date, name: (r.name ?? r.alias).trim() });
const guests = guestPages();

/** Show key (a show alias, or 'guests/<slug>' for a guest mix) and where it links. */
function showOf(alias: string): { key: string; name: string; href: string } {
  const ep = episodes.get(alias)!;
  if (!ep.guest) return { key: ep.show, name: showNames.get(ep.show) ?? ep.show, href: `/shows/${ep.show}/` };
  const page = guests.get(ep.guest);
  return page
    ? { key: `guests/${ep.guest}`, name: page.name, href: `/shows/guests/${ep.guest}/` }
    : { key: `guests/${ep.guest}`, name: ep.name, href: ntsEpisodeUrl(ep.show, alias) };
}

const showNames = new Map(all<{ alias: string; name: string }>("SELECT alias, coalesce(name, alias) name FROM shows").map((r) => [r.alias, r.name]));
const peaks = new Map(all<{ id: number; peak: number }>(
  "SELECT entity_id id, min(rank) peak FROM chart_entries WHERE entity_type = 'artist' AND period_type = 'week' GROUP BY entity_id",
).map((r) => [r.id, r.peak]));
// Theme tunes, by track: [show name, link] for each show the track opens or closes.
const themesByTrack = new Map<number, [string, string][]>();
for (const r of all<{ track: number; key: string; name: string | null }>(
  "SELECT tt.track_id track, tt.show_key key, s.name FROM theme_tunes tt LEFT JOIN shows s ON s.alias = tt.show_key",
)) {
  const g = r.key.startsWith("guests/") ? guestPages().get(r.key.slice(7)) : undefined;
  const label: [string, string] = g ? [g.name, `/shows/guests/${g.slug}/`] : [r.name ?? r.key, `/shows/${r.key}/`];
  themesByTrack.set(r.track, [...(themesByTrack.get(r.track) ?? []), label]);
}
const track = (id: number) => get<{ title: string; credit: string }>("SELECT title_display title, artist_display credit FROM tracks WHERE id = ?", id)!;

const shards: ArtistShard[] = Array.from({ length: ARTIST_SHARDS }, () => ({ a: {}, ep: [], sh: {} }));
const epIndex: Map<string, number>[] = Array.from({ length: ARTIST_SHARDS }, () => new Map());
const search = new Map<string, SearchEntry[]>();
const addSearch = (name: string, path: string, eps: number) => {
  for (const key of new Set(searchWords(name).map(searchKey))) {
    const list = search.get(key) ?? [];
    list.push([name, path, eps]);
    search.set(key, list);
  }
};
const newestFirst = (a: string, b: string) => episodes.get(b)!.date.localeCompare(episodes.get(a)!.date);

let current: { id: number; name: string; slug: string } | null = null;
let tracks = new Map<number, Set<string>>();
let longtail = 0;

function flush() {
  if (!current || !tracks.size) return;
  const eps = new Set<string>();
  for (const set of tracks.values()) for (const e of set) if (episodes.has(e)) eps.add(e);
  if (!eps.size) return;
  addSearch(current.name, `a/${current.slug}`, eps.size);
  if (paged.has(current.id)) return; // has a pre-built page

  const n = artistShard(current.slug);
  const shard = shards[n];
  const idx = (alias: string) => {
    let i = epIndex[n].get(alias);
    if (i == null) {
      const ep = episodes.get(alias)!;
      i = shard.ep.push([ep.show, ep.date, ep.name, alias]) - 1;
      epIndex[n].set(alias, i);
      shard.sh[ep.show] ??= [showNames.get(ep.show) ?? ep.show, `/shows/${ep.show}/`];
    }
    return i;
  };
  const shows = new Map<string, number>();
  const months = new Map<string, number>();
  let first = "9999", last = "";
  for (const a of eps) {
    const { date } = episodes.get(a)!;
    const show = showOf(a);
    shows.set(show.key, (shows.get(show.key) ?? 0) + 1);
    shard.sh[show.key] ??= [show.name, show.href];
    months.set(date.slice(0, 7), (months.get(date.slice(0, 7)) ?? 0) + 1);
    if (date < first) first = date;
    if (date > last) last = date;
  }
  const top = [...tracks]
    .map(([id, set]) => ({ id, eps: [...set].filter((e) => episodes.has(e)).sort(newestFirst) }))
    .filter((t) => t.eps.length)
    .sort((a, b) => b.eps.length - a.eps.length || newestFirst(a.eps[0], b.eps[0]))
    .slice(0, TRACKS_PER_ARTIST);
  const artist: LongtailArtist = {
    n: current.name,
    e: eps.size,
    s: shows.size,
    k: tracks.size,
    f: first,
    l: last,
    p: peaks.get(current.id) ?? null,
    t: top.map((t) => {
      const tr = track(t.id);
      const row: LongtailArtist["t"][number] = [tr.title, tr.credit === current!.name ? null : tr.credit, t.eps.length, t.eps.slice(0, EPISODES_PER_TRACK).map(idx)];
      const themes = themesByTrack.get(t.id);
      if (themes) row.push(themes);
      return row;
    }),
    h: [...shows].sort((a, b) => b[1] - a[1]).slice(0, SHOWS_PER_ARTIST),
    m: [...months].sort((a, b) => a[0].localeCompare(b[0])),
  };
  shard.a[current.slug] = artist;
  longtail++;
}

for (const r of iterate<{ id: number; name: string; slug: string; track: number; episode: string }>(
  `SELECT a.id, a.name, a.slug, p.track_id track, p.episode_alias episode
   FROM artists a JOIN track_artists ta ON ta.artist_id = a.id JOIN plays p ON p.track_id = ta.track_id
   ORDER BY a.id`,
)) {
  if (current?.id !== r.id) {
    flush();
    current = { id: r.id, name: r.name, slug: r.slug };
    tracks = new Map();
  }
  const set = tracks.get(r.track) ?? new Set<string>();
  set.add(r.episode);
  tracks.set(r.track, set);
}
flush();

for (const g of guests.values()) addSearch(g.name, `g/${g.slug}`, g.mixes);
for (const s of all<{ alias: string; name: string; episodes: number }>(
  `SELECT s.alias, coalesce(s.name, s.alias) name, count(e.alias) episodes
   FROM shows s JOIN episodes e ON e.show_alias = s.alias WHERE e.track_count > 0 GROUP BY s.alias`,
)) addSearch(s.name, `s/${s.alias}`, s.episodes);

// Split busy two-letter files by third letter.
const split = new Set<string>();
for (const [key, list] of [...search]) {
  if (list.length <= SPLIT_AT) continue;
  split.add(key);
  search.delete(key);
  for (const entry of list) {
    const files = new Set(searchWords(entry[0]).filter((w) => searchKey(w) === key).map((w) => searchFile(w, split)));
    for (const f of files) {
      const sub = search.get(f) ?? [];
      sub.push(entry);
      search.set(f, sub);
    }
  }
}

// Write everything.
for (const dir of ["data/artists", "data/search"]) {
  rmSync(`${DIST}/${dir}`, { recursive: true, force: true });
  mkdirSync(`${DIST}/${dir}`, { recursive: true });
}
shards.forEach((s, i) => writeFileSync(`${DIST}/data/artists/${i}.json`, JSON.stringify(s)));
for (const [key, list] of search) {
  list.sort((a, b) => b[2] - a[2]);
  writeFileSync(`${DIST}/data/search/${key}.json`, JSON.stringify(list));
}
writeFileSync(`${DIST}/data/search/index.json`, JSON.stringify({ split: [...split].sort() }));

// Astro writes artists/404/index.html; Cloudflare looks for artists/404.html.
if (existsSync(`${DIST}/artists/404/index.html`)) {
  renameSync(`${DIST}/artists/404/index.html`, `${DIST}/artists/404.html`);
  rmSync(`${DIST}/artists/404`, { recursive: true });
}

console.log(
  `Data: ${longtail.toLocaleString()} client-rendered artists in ${ARTIST_SHARDS} files, ` +
    `${search.size + 1} search files (${split.size} prefixes split), ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
