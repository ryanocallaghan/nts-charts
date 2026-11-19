// Pure helpers for matching NTS artists to MusicBrainz and reading what we need (unit-tested).
import { normText } from "./normalize.ts";

export interface MbCredit { name: string; artist: { id: string; name: string } }
export interface MbRecording { id: string; "artist-credit"?: MbCredit[] }
export interface MbSearchArtist { id: string; name: string; score: number; aliases?: { name: string }[] }
export interface MbRelation { type: string; url?: { resource: string } }
export interface MbArtist {
  id: string;
  name: string;
  type?: string | null;
  disambiguation?: string;
  area?: { name: string } | null;
  "begin-area"?: { name: string } | null;
  "life-span"?: { begin?: string | null; end?: string | null; ended?: boolean };
  relations?: MbRelation[];
  annotation?: string | null;
}

/**
 * From an ISRC lookup's recordings, the MBID of the credited artist whose name matches ours.
 * Null when nobody matches, or when different matching artists appear (ambiguous).
 */
export function matchCredit(recordings: MbRecording[], name: string): string | null {
  const want = normText(name);
  const ids = new Set<string>();
  for (const r of recordings) {
    for (const c of r["artist-credit"] ?? []) {
      if (normText(c.artist.name) === want || normText(c.name) === want) ids.add(c.artist.id);
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * Accept a name search only when exactly one result matches the name, or one of its aliases (e.g.
 * "Ryūichi Sakamoto" for 坂本龍一), exactly. Search scores aren't trusted: alias hits score lower.
 */
export function acceptSearch(results: MbSearchArtist[], name: string): string | null {
  const want = normText(name);
  const exact = results.filter((a) => normText(a.name) === want || (a.aliases ?? []).some((al) => normText(al.name) === want));
  return exact.length === 1 ? exact[0].id : null;
}

export interface Links { bandcamp?: string; instagram?: string; discogs?: string }

/** The first Bandcamp, Instagram and Discogs links, plus the Wikidata item, from an artist's URL relations. */
export function pickLinks(relations: MbRelation[] = []): { links: Links; wikidata?: string } {
  const links: Links = {};
  let wikidata: string | undefined;
  for (const r of relations) {
    const url = r.url?.resource;
    if (!url) continue;
    if (r.type === "bandcamp") links.bandcamp ??= url;
    else if (r.type === "discogs") links.discogs ??= url;
    else if (r.type === "social network" && /(^|\.)instagram\.com\//i.test(new URL(url).host + "/")) links.instagram ??= url;
    else if (r.type === "wikidata") wikidata ??= url.match(/Q\d+$/)?.[0];
  }
  return { links, wikidata };
}

const GROUP_TYPES = new Set(["Group", "Orchestra", "Choir"]);

/** Facts for the artist page: type, where from, and (for groups) active years. No birth dates. */
export function facts(a: MbArtist) {
  const year = (s?: string | null) => (s ? Number(s.slice(0, 4)) : null);
  const group = a.type ? GROUP_TYPES.has(a.type) : false;
  return {
    type: a.type ?? null,
    area: a["begin-area"]?.name ?? a.area?.name ?? null,
    begin_year: group ? year(a["life-span"]?.begin) : null,
    end_year: group ? year(a["life-span"]?.end) : null,
    disambiguation: a.disambiguation || null,
  };
}

/** The first sentences of a Wikipedia extract, up to about `maxChars`. */
export function trimBio(text: string, maxSentences = 2, maxChars = 320): string {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = "";
  for (const s of sentences.slice(0, maxSentences)) {
    if (out && (out + s).length > maxChars) break;
    out += s;
  }
  out = out.trim();
  return out.length > maxChars ? `${out.slice(0, maxChars - 1).replace(/\s+\S*$/, "")}…` : out;
}

/**
 * Plain text from a MusicBrainz annotation (editor-written wiki markup): drops headings, rules and
 * list markers, keeps link text, and removes ''italic'' / '''bold''' quotes and HTML.
 */
export function cleanAnnotation(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(=+.*=+|-{4,})\s*$/.test(line)) // headings, horizontal rules
    .map((line) => line.replace(/^\s*[*#]+\s*/, ""))        // list markers
    .join(" ")
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")               // [url|text] -> text
    .replace(/\[(?:https?:\/\/|mbid:|artist:|release:)[^\]]*\]/g, "") // bare [url]
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
