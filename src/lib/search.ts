// Search text and result formatting, shared by ingest (which builds the search table), the server
// and the browser. Keep this file free of Node-only imports.
import { slugify } from "../../ingest/normalize.ts";

/** Lowercase, strip accents and punctuation: "Björk & Co." -> "bjork co". */
export function searchNorm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type SearchKind = "artist" | "show" | "guest" | "track";

/** A track's URL segment, "<id>-<slug>": the id finds it, the slug is for people. */
export function trackKey(id: number, artistDisplay: string, title: string): string {
  const slug = slugify(`${artistDisplay} ${title}`);
  return slug ? `${id}-${slug}` : String(id);
}

export function trackHref(t: { id: number; artistDisplay: string; title: string }): string {
  return `/tracks/${trackKey(t.id, t.artistDisplay, t.title)}/`;
}

export interface SearchResult { name: string; href: string; meta: string }

export function searchHref(kind: SearchKind, key: string): string {
  const base = { artist: "/artists/", guest: "/shows/guests/", show: "/shows/", track: "/tracks/" }[kind];
  return `${base}${key}/`;
}

export function searchMeta(kind: SearchKind, episodes: number): string {
  const n = episodes.toLocaleString("en-GB");
  if (kind === "guest") return `Guest · ${n} mix${episodes === 1 ? "" : "es"}`;
  return `${{ artist: "Artist", show: "Show", track: "Track" }[kind]} · ${n} episode${episodes === 1 ? "" : "s"}`;
}

/** The line above the results. */
export function searchStatus(r: { short: boolean; total: number }): string {
  if (r.short) return "Keep typing…";
  return r.total ? `${r.total.toLocaleString("en-GB")} match${r.total === 1 ? "" : "es"}` : "No matches.";
}
