import { describe, expect, it } from "vitest";
import { searchHref, searchMeta, searchNorm, searchStatus, trackHref, trackKey } from "./search.ts";

describe("searchNorm", () => {
  it("normalises accents and punctuation", () => {
    expect(searchNorm("Björk & Co.")).toBe("bjork co");
    expect(searchNorm("  Sade—Smooth_Operator ")).toBe("sade smooth operator");
  });
});

describe("search results", () => {
  it("links each kind to its page", () => {
    expect(searchHref("artist", "kelela")).toBe("/artists/kelela/");
    expect(searchHref("show", "helm")).toBe("/shows/helm/");
    expect(searchHref("guest", "dj-python")).toBe("/shows/guests/dj-python/");
    expect(searchHref("track", "12-kelela-rewind")).toBe("/tracks/12-kelela-rewind/");
  });
  it("describes each result", () => {
    expect(searchMeta("artist", 1)).toBe("Artist · 1 episode");
    expect(searchMeta("show", 1200)).toBe("Show · 1,200 episodes");
    expect(searchMeta("guest", 3)).toBe("Guest · 3 mixes");
    expect(searchMeta("track", 2)).toBe("Track · 2 episodes");
  });
  it("says how many matched", () => {
    expect(searchStatus({ short: true, total: 0 })).toBe("Keep typing…");
    expect(searchStatus({ short: false, total: 0 })).toBe("No matches.");
    expect(searchStatus({ short: false, total: 1 })).toBe("1 match");
    expect(searchStatus({ short: false, total: 2345 })).toBe("2,345 matches");
  });
});

describe("track URLs", () => {
  it("are the id plus a readable slug of artist and title", () => {
    expect(trackKey(12, "Kelela", "Rewind")).toBe("12-kelela-rewind");
    expect(trackHref({ id: 7, artistDisplay: "Björk & Co.", title: "Jóga (Live)" })).toBe("/tracks/7-bjork-and-co-joga-live/");
  });
  it("fall back to the id when nothing is left of the name", () => {
    expect(trackKey(99, "???", "!!!")).toBe("99");
  });
});
