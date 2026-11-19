// Umami analytics events (cookie-free; the script is added by Base.astro when UMAMI_WEBSITE_ID is set).
// Without the script (not configured, blocked, or this browser opted out at /ignore-me/) these do nothing.
// Page views are recorded without query strings, so searches and chart filters are sent as events instead.
// Clicks on elements with data-umami-event are counted by Umami itself, including links leaving the site.

type EventData = Record<string, string | number>;
declare global {
  interface Window { umami?: { track: (name: string, data?: EventData) => void } }
}

export function track(name: string, data?: EventData) {
  const send = () => window.umami?.track(name, data);
  if (window.umami || document.readyState === "complete") send();
  else addEventListener("load", send, { once: true });
}

/** What a site link points at, for event data: artist, show, guest, track or search. */
export function linkKind(href: string): string {
  const path = new URL(href, location.href).pathname;
  if (path.startsWith("/shows/guests/")) return "guest";
  const first = path.split("/")[1] ?? "";
  return { artists: "artist", shows: "show", tracks: "track", search: "search" }[first] ?? first;
}

/** A search term as sent: trimmed, lower case and short, so one search isn't counted under many spellings. */
export const searchTerm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);

function onLoad() {
  // Listening: every link out to an episode or show on nts.live.
  document.querySelectorAll<HTMLAnchorElement>('a[href^="https://www.nts.live/"]').forEach((a) => {
    a.dataset.umamiEvent ??= "Listen on NTS";
  });
  const params = new URLSearchParams(location.search);
  // A chart opened with a filter, by its form or from a shared link.
  if (location.pathname.startsWith("/charts/")) {
    const genre = params.get("genre"), place = params.get("place");
    if (genre) track("Filtered chart", { genre });
    if (place) track("Filtered chart", { place });
  }
  // A search page opened with a term (from the header box, or with JavaScript off).
  if (location.pathname === "/search/" && params.get("q")) {
    const list = document.getElementById("results");
    const results = Number(list?.dataset.total ?? list?.children.length ?? 0);
    track("Searched", { q: searchTerm(params.get("q")!), results });
  }
}

onLoad();
