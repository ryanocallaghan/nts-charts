// Search text and result formatting, shared by ingest (which builds the search table), the server
// and the browser. Keep this file free of Node-only imports.

/** Lowercase, strip accents and punctuation: "Björk & Co." -> "bjork co". */
export function searchNorm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type SearchKind = "artist" | "show" | "guest";

export interface SearchResult { name: string; href: string; meta: string }

export function searchHref(kind: SearchKind, key: string): string {
  return kind === "artist" ? `/artists/${key}/` : kind === "guest" ? `/shows/guests/${key}/` : `/shows/${key}/`;
}

export function searchMeta(kind: SearchKind, episodes: number): string {
  const n = episodes.toLocaleString("en-GB");
  if (kind === "guest") return `Guest · ${n} mix${episodes === 1 ? "" : "es"}`;
  return `${kind === "artist" ? "Artist" : "Show"} · ${n} episode${episodes === 1 ? "" : "s"}`;
}

/** The line above the results. */
export function searchStatus(r: { short: boolean; total: number }): string {
  if (r.short) return "Keep typing…";
  return r.total ? `${r.total.toLocaleString("en-GB")} match${r.total === 1 ? "" : "es"}` : "No matches.";
}
