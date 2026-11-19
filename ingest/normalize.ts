// Track / artist identity. Pure functions — unit tested in normalize.test.ts.

/** Lowercase, strip accents, collapse punctuation to single spaces. Unicode-aware (keeps non-Latin scripts). */
export function normText(s: string): string {
  const out = s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // Titles made only of punctuation ("???", "...") would normalise to ""; keep them distinct.
  return out || s.trim().toLowerCase();
}

const FEAT_BRACKET = /\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]/i;
const FEAT_INLINE = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/** Pull "(feat. X)" out of a title. */
export function splitTitle(title: string): { title: string; featured: string[] } {
  const m = title.match(FEAT_BRACKET);
  if (!m) return { title: title.trim(), featured: [] };
  return { title: title.replace(FEAT_BRACKET, "").trim(), featured: splitNames(m[1]) };
}

// Band names that contain separators. Matched on normText of the whole segment.
const DO_NOT_SPLIT = new Set(
  [
    "Simon & Garfunkel", "Earth, Wind & Fire", "Crosby, Stills, Nash & Young", "Crosby, Stills & Nash",
    "Hall & Oates", "Peter, Paul and Mary", "Emerson, Lake & Palmer", "Blood, Sweat & Tears",
    "Ike & Tina Turner", "Sam & Dave", "Womack & Womack", "Ashford & Simpson", "Chas & Dave",
    "Kruder & Dorfmeister", "Rhythm & Sound", "Zapp & Roger", "Peaches & Herb",
    "Tyler, The Creator",
  ].map(normText),
);

const SEP = /\s*,\s*|\s+&\s+|\s+x\s+|\s+vs\.?\s+|\s+\/\s+/g;

/** Split a credit string on ", " / " & " / " x " / " vs " / " / " — unless that would break a known band name. */
function splitNames(s: string): string[] {
  const whole = s.trim();
  if (!whole) return [];
  if (DO_NOT_SPLIT.has(normText(whole))) return [whole];
  const parts = whole.split(SEP);
  const seps = [...whole.matchAll(SEP)].map((m) => m[0]);
  const out: string[] = [];
  parts.forEach((p, i) => {
    const sep = seps[i - 1];
    // Re-join "X & The Y" bands ("Echo & The Bunnymen"); ", The" only for allow-listed names
    // ("Tyler, The Creator") since "Kevin Richard Martin, The Bug" is two artists.
    const prev = out[out.length - 1];
    const andThe = sep?.trim() === "&" && /^the\s/i.test(p);
    const known = sep?.trim() === "," && DO_NOT_SPLIT.has(normText(`${prev}${sep}${p}`));
    if (i > 0 && (andThe || known)) out[out.length - 1] += `${sep}${p}`;
    else out.push(p);
  });
  return out.map((p) => p.trim()).filter(Boolean);
}

/** Main + featured artist names from a raw artist credit and title. */
export function splitArtists(artist: string, title = ""): { main: string[]; featured: string[] } {
  const [mainPart, ...featParts] = artist.split(FEAT_INLINE);
  const main = splitNames(mainPart);
  const featured = [...featParts.flatMap(splitNames), ...splitTitle(title).featured];
  return { main, featured: featured.filter((f) => !main.some((m) => normText(m) === normText(f))) };
}

/** Text identity of a recording: main artists (sorted) + title without feat credits. */
export function trackKey(artist: string, title: string): string {
  const { main } = splitArtists(artist, title);
  const artists = main.map(normText).sort().join(",");
  return `${artists}|${normText(splitTitle(title).title)}`;
}

// Placeholder credits DJs/NTS use for unidentified records. These are not real tracks.
const PLACEHOLDER_ARTISTS = new Set(
  ["unknown", "unknown artist", "unknown artists", "various", "various artists", "va", "n/a", "id", "tba", "tbc",
   "unidentified", "unidentified artist", "artist", "no artist", "?", "??", "???",
   // "Untitled" as a *credit* is a placeholder; "Untitled" as a song title by a real artist is a real track.
   "untitled", "untitled artist"].map(normText),
);
const PLACEHOLDER_TITLES = new Set(
  ["unknown", "unknown track", "unknown title", "id", "tba", "tbc", "unidentified", "track", "?", "??", "???"].map(normText),
);

/** True for "Unknown Artist – Unknown Track", "ID – ID" and similar placeholder rows. */
export function isPlaceholder(artist: string, title: string): boolean {
  return PLACEHOLDER_ARTISTS.has(normText(artist)) || PLACEHOLDER_TITLES.has(normText(title));
}

/** URL slug; falls back to "" for non-Latin names (caller assigns an id-based slug). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
