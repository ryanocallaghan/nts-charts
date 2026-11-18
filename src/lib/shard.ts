// Shared by the build and the browser: how artist data and search entries are split into files.
// Keep this file free of Node-only imports.

/** Number of artist data files (/data/artists/<n>.json). */
export const ARTIST_SHARDS = 1024;

/** FNV-1a hash of a slug, mapped to a shard number. */
export function artistShard(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % ARTIST_SHARDS;
}

/** Lowercase, strip accents and punctuation: "Björk & Co." -> "bjork co". */
export function searchNorm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const ALNUM = /[a-z0-9]/;

/** Words too common to index on their own (they'd make huge search files). */
export const STOPWORDS = new Set(["the", "and", "of", "a", "an", "dj", "mc", "de", "la", "le", "el", "los", "les", "y", "w", "feat", "ft", "vs", "with"]);

/**
 * The two-letter search file a word lives in: "ke" for "kelela", "k_" for one-letter words, or one of
 * 32 buckets ("x07") for words starting outside a–z/0–9 (other scripts).
 */
export function searchKey(word: string): string {
  const [a, b] = [word[0], word[1]];
  if (!ALNUM.test(a)) return `x${String(a.codePointAt(0)! % 32).padStart(2, "0")}`;
  return a + (b && ALNUM.test(b) ? b : "_");
}

/** Busy two-letter files are split by third letter ("kel"); `split` lists the keys that were. */
export function searchFile(word: string, split: Set<string>): string {
  const key = searchKey(word);
  if (!split.has(key)) return key;
  const c = word[2];
  return key + (c && ALNUM.test(c) ? c : "_");
}

/** The words of a name worth indexing: all but stopwords (unless that leaves nothing). */
export function searchWords(name: string): string[] {
  const words = searchNorm(name).split(" ").filter(Boolean);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  return [...new Set(kept.length ? kept : words)];
}
