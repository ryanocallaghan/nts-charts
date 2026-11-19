import { describe, expect, it } from "vitest";
import { searchHref, searchMeta, searchNorm, searchStatus } from "./search.ts";

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
  });
  it("describes each result", () => {
    expect(searchMeta("artist", 1)).toBe("Artist · 1 episode");
    expect(searchMeta("show", 1200)).toBe("Show · 1,200 episodes");
    expect(searchMeta("guest", 3)).toBe("Guest · 3 mixes");
  });
  it("says how many matched", () => {
    expect(searchStatus({ short: true, total: 0 })).toBe("Keep typing…");
    expect(searchStatus({ short: false, total: 0 })).toBe("No matches.");
    expect(searchStatus({ short: false, total: 1 })).toBe("1 match");
    expect(searchStatus({ short: false, total: 2345 })).toBe("2,345 matches");
  });
});
