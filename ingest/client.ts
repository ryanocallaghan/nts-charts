// Polite NTS API client: global request spacing, retries with backoff.
export const API = "https://www.nts.live/api/v2";
const USER_AGENT = "nts-charts/0.1 (unofficial chart site)";
const RPS = Number(process.env.NTS_RPS ?? 2);
const MIN_INTERVAL_MS = 1000 / RPS;

let nextSlot = 0;
/** Resolves when this caller may start a request; spaces request starts globally. */
function throttle(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_INTERVAL_MS;
  return new Promise((r) => setTimeout(r, at - now));
}

export let requestCount = 0;

/** GET JSON. Returns null for 404 and 422 ("offset not allowed"). */
export async function getJson<T = any>(pathOrUrl: string, tries = 5): Promise<T | null> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}/${pathOrUrl.replace(/^\//, "")}`;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    requestCount++;
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
      if (res.status === 404 || res.status === 422) return null;
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
      if (attempt + 1 >= tries) throw new Error(`HTTP ${res.status} for ${url} after ${tries} tries`);
    } catch (err) {
      if (attempt + 1 >= tries || (err instanceof Error && err.message.startsWith("HTTP 4"))) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

export async function getText(url: string): Promise<Buffer> {
  await throttle();
  requestCount++;
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Run fn over items with bounded concurrency (throttle still caps the request rate). */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

// ---- API shapes (only the fields we use) ----
export interface Tag { id: string; value: string }
export interface Media { picture_medium?: string; background_medium?: string }
export interface ApiShow {
  show_alias: string; name: string; location_long?: string; genres?: Tag[]; media?: Media; updated?: string;
}
export interface ApiEpisode {
  episode_alias: string; show_alias: string; name: string; broadcast: string;
  genres?: Tag[]; moods?: Tag[]; location_long?: string; media?: Media;
}
export interface ApiTrack {
  artist: string | null; title: string | null; uid: string;
  offset: number | null; offset_estimate: number | null;
  isrc_id: string | null; deezer_track_id: number | null;
}
export interface Page<T> { metadata?: { resultset?: { count: number; offset: number; limit: number } }; results: T[] }
