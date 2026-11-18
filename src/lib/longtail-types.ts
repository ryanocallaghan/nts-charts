// Formats of the files written by scripts/build-data.ts and read by the browser.

/** One artist, compact. Track episode lists are indexes into the shard's `ep`. */
export interface LongtailArtist {
  n: string; // name
  e: number; // distinct episodes
  s: number; // distinct shows
  k: number; // distinct tracks
  f: string; // first play (YYYY-MM-DD)
  l: string; // last play
  p: number | null; // peak weekly rank, if it ever charted
  // Most-played first; eps newest first; themes: shows this track is the theme tune of ([name, href]).
  t: [title: string, credit: string | null, episodes: number, eps: number[], themes?: [string, string][]][];
  h: [show: string, episodes: number][]; // show keys (see ArtistShard.sh); guests count individually
  m: [month: string, episodes: number][];
}

export interface ArtistShard {
  a: Record<string, LongtailArtist>; // by slug
  ep: [show: string, date: string, name: string, alias: string][];
  sh: Record<string, [name: string, href: string]>; // show key (alias, or 'guests/<slug>') -> name and link
}

/** [name, path ("a/slug", "s/alias" or "g/guest-slug"), episodes (mixes for guests)] */
export type SearchEntry = [string, string, number];
