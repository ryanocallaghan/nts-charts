import { describe, expect, it } from "vitest";
import { cleanTitle, discogsUrl, firstArtist, mapGenres, pickStyles, sameArtist, type DiscogsResult } from "./discogs.ts";

const r = (title: string, style: string[], extra: Partial<DiscogsResult> = {}): DiscogsResult => ({ id: 1, title, style, genre: [], format: ["Vinyl", "12\""], ...extra });

describe("query helpers", () => {
  it("takes the first credited artist", () => {
    expect(firstArtist("Kavinsky, Lovefoxxx")).toBe("Kavinsky");
    expect(firstArtist("Erykah Badu & The Alchemist")).toBe("Erykah Badu");
    expect(firstArtist("Gregory Uhlmann feat. Alabaster DePlume")).toBe("Gregory Uhlmann");
    expect(firstArtist("Sade")).toBe("Sade");
  });
  it("drops bracketed parts of titles", () => {
    expect(cleanTitle("Can You Feel It (Instrumental)")).toBe("Can You Feel It");
    expect(cleanTitle("Tera [K-Lone Remix]")).toBe("Tera");
    expect(cleanTitle("(Untitled)")).toBe("(Untitled)");
  });
});

describe("sameArtist", () => {
  it("matches the whole name, not a longer one", () => {
    expect(sameArtist(r("Zena Foster - Baby", []), "Zena")).toBe(false);
    expect(sameArtist(r("Zena - It's You", []), "Zena")).toBe(true);
  });
  it("allows Discogs' numbering, name variations and a leading The", () => {
    expect(sameArtist(r("Anna (2) - Hidden Beauties", []), "Anna")).toBe(true);
    expect(sameArtist(r("H Takahashi* - Body Trip", []), "H. Takahashi")).toBe(true);
    expect(sameArtist(r("The Supremes - Love Child", []), "Supremes")).toBe(true);
  });
  it("finds the artist among several", () => {
    expect(sameArtist(r("Sam Amidon, Sam Wilkes (2) - Froggy", []), "Sam Wilkes")).toBe(true);
    expect(sameArtist(r("Devon Rexi Meets John T. Gast - Mashrub", []), "John T. Gast")).toBe(true);
  });
  it("skips compilations", () => {
    expect(sameArtist(r("Various - Fabric 01", []), "Terry Francis")).toBe(false);
  });
});

describe("pickStyles", () => {
  it("prefers a release named after the track to an album", () => {
    const p = pickStyles([
      r("Mariah Carey - Music Box", ["Ballad", "Contemporary R&B", "Soft Rock"]),
      r("Mariah Carey - Dreamlover", ["Contemporary R&B"], { format: ["CD", "Single"] }),
    ], "Mariah Carey", "Dreamlover");
    expect(p?.result.title).toBe("Mariah Carey - Dreamlover");
    expect(p?.styles).toEqual(["Contemporary R&B"]);
  });
  it("keeps all of a single's styles but only the first few of an album's", () => {
    const styles = ["Dance-pop", "Alt-Pop", "House", "Contemporary R&B", "Ballroom"];
    expect(pickStyles([r("FKA Twigs - Eusexua", styles)], "FKA Twigs", "Hard")?.styles).toEqual(["Dance-pop", "Alt-Pop", "House"]);
    expect(pickStyles([r("FKA Twigs - Hard", styles)], "FKA Twigs", "Hard")?.styles).toEqual(styles);
  });
  it("adds styles most of the releases agree on", () => {
    const p = pickStyles([
      r("Massive Attack - Teardrop", ["Trip Hop"]),
      r("Massive Attack - Teardrop", ["Trip Hop", "Downtempo"]),
      r("Massive Attack - Teardrop", ["Downtempo"]),
      r("Massive Attack - Teardrop", ["Leftfield"]),
    ], "Massive Attack", "Teardrop");
    expect(p?.styles).toEqual(["Trip Hop", "Downtempo"]);
  });
  it("ignores bootlegs, videos and other artists", () => {
    expect(pickStyles([
      r("Massive Attack - Live", ["Trip Hop"], { format: ["CD", "Unofficial Release"] }),
      r("Massive Attack - Eleven Promos", ["Trip Hop"], { format: ["DVD"] }),
      r("Massive Attacks - Teardrop", ["Trip Hop"]),
    ], "Massive Attack", "Teardrop")).toBeNull();
  });
});

describe("mapGenres", () => {
  const nts = new Set(["rnb", "house", "hip-hop", "jazz", "trip-hop"]);
  it("uses NTS's tag where it's the same genre, and Discogs' style otherwise", () => {
    expect(mapGenres(["Contemporary R&B", "House", "Downtempo"], [], nts)).toEqual([
      { slug: "rnb", name: "Contemporary R&B" }, { slug: "house", name: "House" }, { slug: "downtempo", name: "Downtempo" },
    ]);
  });
  it("adds only the coherent top-level genres", () => {
    expect(mapGenres(["Trip Hop"], ["Electronic", "Hip Hop", "Pop"], nts).map((g) => g.slug)).toEqual(["trip-hop", "hip-hop"]);
  });
  it("leaves out descriptions and duplicates", () => {
    expect(mapGenres(["Vocal", "RnB/Swing", "Contemporary R&B"], [], nts).map((g) => g.slug)).toEqual(["rnb"]);
  });
});

it("links to the Discogs page", () => {
  expect(discogsUrl({ id: 5, type: "master", uri: "/master/5-Massive-Attack-Teardrop", title: "" })).toBe("https://www.discogs.com/master/5-Massive-Attack-Teardrop");
  expect(discogsUrl({ id: 7, type: "release", title: "" })).toBe("https://www.discogs.com/release/7");
});
