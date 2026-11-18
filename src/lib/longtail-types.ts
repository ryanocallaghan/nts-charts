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
  t: [title: string, credit: string | null, episodes: number, eps: number[]][]; // most-played first, eps newest first
  h: [show: string, episodes: number][];
  m: [month: string, episodes: number][];
}

export interface ArtistShard {
  a: Record<string, LongtailArtist>; // by slug
  ep: [show: string, date: string, name: string, alias: string][];
  sh: Record<string, string>; // show alias -> name
}

/** [name, path ("a/slug" or "s/alias"), episodes] */
export type SearchEntry = [string, string, number];
