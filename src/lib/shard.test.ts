import { describe, expect, it } from "vitest";
import { ARTIST_SHARDS, artistShard, searchFile, searchKey, searchNorm, searchWords } from "./shard.ts";

describe("artistShard", () => {
  it("is stable and in range", () => {
    expect(artistShard("aphex-twin")).toBe(artistShard("aphex-twin"));
    for (const s of ["a", "björk", "kelela", "x".repeat(200)]) {
      const n = artistShard(s);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(ARTIST_SHARDS);
    }
  });
});

describe("search keys", () => {
  it("normalises accents and punctuation", () => {
    expect(searchNorm("Björk & Co.")).toBe("bjork co");
  });
  it("drops stopwords unless nothing else is left", () => {
    expect(searchWords("The Cure")).toEqual(["cure"]);
    expect(searchWords("DJ Python")).toEqual(["python"]);
    expect(searchWords("The The")).toEqual(["the"]);
  });
  it("buckets by two letters, one-letter words and other scripts", () => {
    expect(searchKey("kelela")).toBe("ke");
    expect(searchKey("r")).toBe("r_");
    expect(searchKey("坂本")).toMatch(/^x\d\d$/);
  });
  it("splits busy prefixes by third letter", () => {
    const split = new Set(["ke"]);
    expect(searchFile("kelela", split)).toBe("kel");
    expect(searchFile("ke", split)).toBe("ke_");
    expect(searchFile("aphex", split)).toBe("ap");
  });
});
