// Record genres from Discogs: which release a track is on, and which of that release's styles count
// as the track's genres. Pure functions; ingest/record-genres.ts does the requests, aggregate.ts the mapping.
import { slugify } from "./normalize.ts";

/** One result from GET /database/search (type master or release). */
export interface DiscogsResult {
  id: number;
  type?: string;
  uri?: string;
  title: string; // "Artist - Release"
  year?: string | number | null;
  format?: string[];
  genre?: string[];
  style?: string[];
}

/** The first credited artist of an NTS credit ("Kavinsky, Lovefoxxx" → "Kavinsky"). */
export function firstArtist(credit: string): string {
  return credit.split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bx\b|\band\b|\bvs\.?)\s*/i)[0].trim() || credit.trim();
}

/** A title without bracketed parts ("Can You Feel It (Instrumental)" → "Can You Feel It"). */
export function cleanTitle(title: string): string {
  return title.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").trim() || title.trim();
}

// Discogs numbers artists who share a name ("Anna (2)") and marks name variations with "*".
const artistKey = (s: string) => slugify(s.replace(/\s*\(\d+\)|\*/g, "").replace(/^the\s+/i, ""));

/**
 * Whether a result is by the artist, as one of its credited names. Discogs' search matches names
 * loosely ("Zena" finds "Zena Foster"), and compilations ("Various") say nothing about this track.
 */
export function sameArtist(result: DiscogsResult, artist: string): boolean {
  const credit = result.title.split(" - ")[0];
  const q = artistKey(artist);
  if (!q) return false;
  const names = [credit, ...credit.split(/\s*(?:,|&|\/|\+|\bfeat\.?|\bfeaturing\b|\bwith\b|\bvs\.?|\band\b|\bmeets\b)\s*/i)];
  return names.some((n) => artistKey(n) === q);
}

// Bootlegs and videos are filed under any style; skip them.
const SKIP_FORMATS = /Unofficial|DVD|VHS|Laserdisc|Blu-ray/i;

/** Most styles a track takes from an album (an album's styles cover all its tracks, not this one). */
export const ALBUM_STYLES = 3;

export interface Pick { result: DiscogsResult; styles: string[]; genres: string[] }

/**
 * The release that best stands for the track, and the styles that count:
 * - only the artist's own, official, audio releases
 * - a single or EP named after the track if there is one, since it's about this track; otherwise an album
 * - styles on the first such release, plus any on at least half of the first five
 * - from an album, at most ALBUM_STYLES of them
 */
export function pickStyles(results: DiscogsResult[], artist: string, title: string): Pick | null {
  const usable = results.filter((r) => !SKIP_FORMATS.test((r.format ?? []).join(",")) && sameArtist(r, artist));
  if (!usable.length) return null;
  const want = slugify(cleanTitle(title));
  const named = usable.filter((r) => slugify(cleanTitle(r.title.split(" - ").slice(1).join(" - "))) === want);
  const chosen = (named.length ? named : usable).slice(0, 5);
  const counts = new Map<string, number>();
  for (const r of chosen) for (const s of new Set(r.style ?? [])) counts.set(s, (counts.get(s) ?? 0) + 1);
  const first = chosen[0].style ?? [];
  const extra = [...counts].filter(([s, n]) => !first.includes(s) && n >= chosen.length / 2).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  let styles = [...new Set([...first, ...extra])];
  if (!named.length) styles = styles.slice(0, ALBUM_STYLES);
  return { result: chosen[0], styles, genres: chosen[0].genre ?? [] };
}

// ---------- Discogs names → genre slugs ----------

/** Discogs styles that are NTS tags under another name. */
const STYLE_ALIASES: Record<string, string> = {
  "Contemporary R&B": "rnb", "RnB/Swing": "rnb", "Neo Soul": "soul", "UK Street Soul": "soul",
  "Drum n Bass": "drum-and-bass", "Nu-Disco": "disco", "Italo-Disco": "italo", "Acid House": "acid",
  "Garage House": "garage", "Minimal Techno": "minimal", "Deep Techno": "techno", "Bossanova": "bossa-nova",
  "MPB": "musica-popular-brasileira", "Fusion": "jazz-fusion", "Roots Reggae": "reggae",
  "Field Recording": "field-recordings", "Score": "soundtrack", "Theme": "soundtrack",
  "Pop Rap": "rap", "Gangsta": "gangsta-rap", "Thug Rap": "gangsta-rap", "Hardcore Hip-Hop": "hip-hop",
  "Boom Bap": "hip-hop", "Conscious": "hip-hop", "Jazzy Hip-Hop": "hip-hop", "Screw": "chopped-n-screwed",
};

/** Discogs' top-level genres that are coherent enough to count (Electronic, Rock, Pop and the like are too broad). */
const GENRE_ALIASES: Record<string, string> = {
  "Hip Hop": "hip-hop", Jazz: "jazz", Reggae: "reggae", Classical: "classical", Blues: "blues", Latin: "latin",
};

/** Styles that describe a record rather than its genre. */
const NOT_GENRES = new Set([
  "Vocal", "Instrumental", "Acoustic", "Contemporary", "Modern", "Ballad", "Holiday", "Erotic", "Parody", "Religious",
  "Therapy", "Poetry", "Piano", "Organ", "Orchestra", "Music Video", "Concert Film", "DJ Battle Tool", "Public Broadcast",
  "Early", "Comedy", "Dialogue", "Education", "Novelty",
]);

/**
 * A track's genres from its release's styles and genres: an NTS tag where Discogs' name is the same
 * thing (`ntsSlugs`), otherwise the Discogs style under its own name. Each slug once.
 */
export function mapGenres(styles: string[], genres: string[], ntsSlugs: ReadonlySet<string>): { slug: string; name: string }[] {
  const out = new Map<string, string>();
  for (const s of styles) {
    if (NOT_GENRES.has(s)) continue;
    const alias = STYLE_ALIASES[s];
    const slug = alias && ntsSlugs.has(alias) ? alias : slugify(s);
    if (slug && !out.has(slug)) out.set(slug, s);
  }
  for (const g of genres) {
    const slug = GENRE_ALIASES[g];
    if (slug && ntsSlugs.has(slug) && !out.has(slug)) out.set(slug, g);
  }
  return [...out].map(([slug, name]) => ({ slug, name }));
}

/** A Discogs page for a result: its uri, or the master/release by id. */
export function discogsUrl(r: Pick["result"]): string | null {
  if (r.uri) return `https://www.discogs.com${r.uri}`;
  return r.id ? `https://www.discogs.com/${r.type === "master" ? "master" : "release"}/${r.id}` : null;
}
