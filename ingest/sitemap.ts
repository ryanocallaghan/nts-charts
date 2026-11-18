import { gunzipSync } from "node:zlib";
import { getText } from "./client.ts";

const INDEX = "https://www.nts.live/sitemap.xml";

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

function maybeGunzip(buf: Buffer): string {
  return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
}

export interface SitemapEntries {
  shows: string[];
  episodes: { show: string; episode: string }[];
}

/** All show and episode aliases listed in the NTS sitemaps (the API's pagination can't reach them all). */
export async function readSitemap(): Promise<SitemapEntries> {
  const index = locs(maybeGunzip(await getText(INDEX)));
  const shows = new Set<string>();
  const episodes = new Map<string, string>();
  for (const sm of index) {
    for (const url of locs(maybeGunzip(await getText(sm)))) {
      const ep = url.match(/\/shows\/([^/]+)\/episodes\/([^/?#]+)$/);
      if (ep) { episodes.set(ep[2], ep[1]); shows.add(ep[1]); continue; }
      const sh = url.match(/\/shows\/([^/?#]+)$/);
      if (sh) shows.add(sh[1]);
    }
  }
  return {
    shows: [...shows],
    episodes: [...episodes].map(([episode, show]) => ({ show, episode })),
  };
}
