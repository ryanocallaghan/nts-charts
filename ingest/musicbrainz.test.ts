import { describe, expect, it } from "vitest";
import { acceptSearch, cleanAnnotation, facts, matchCredit, pickLinks, trimBio } from "./musicbrainz.ts";

const credit = (id: string, name: string, credited = name) => ({ name: credited, artist: { id, name } });

describe("matchCredit", () => {
  it("finds our artist among a recording's credits", () => {
    const recs = [{ id: "r1", "artist-credit": [credit("a1", "Robin Guthrie"), credit("a2", "Harold Budd")] }];
    expect(matchCredit(recs, "Harold Budd")).toBe("a2");
  });
  it("matches credited names and ignores case and punctuation", () => {
    expect(matchCredit([{ id: "r", "artist-credit": [credit("x", "Björk", "BJÖRK")] }], "bjork")).toBe("x");
  });
  it("returns null when nobody matches or when two different artists share the name", () => {
    expect(matchCredit([{ id: "r", "artist-credit": [credit("x", "Someone Else")] }], "Kelela")).toBeNull();
    const twins = [{ id: "r1", "artist-credit": [credit("x", "Nomi")] }, { id: "r2", "artist-credit": [credit("y", "Nomi")] }];
    expect(matchCredit(twins, "Nomi")).toBeNull();
  });
});

describe("acceptSearch", () => {
  it("accepts a single perfect exact match", () => {
    expect(acceptSearch([{ id: "a", name: "Model 500", score: 100 }, { id: "b", name: "Model 5000", score: 70 }], "Model 500")).toBe("a");
  });
  it("rejects ambiguous or inexact matches", () => {
    expect(acceptSearch([{ id: "a", name: "Fine", score: 100 }, { id: "b", name: "Fine", score: 100 }], "Fine")).toBeNull();
    expect(acceptSearch([{ id: "a", name: "Kleine", score: 100 }], "Klein")).toBeNull();
  });
  it("accepts a unique exact alias match", () => {
    expect(acceptSearch([{ id: "s", name: "坂本龍一", score: 80, aliases: [{ name: "Ryūichi Sakamoto" }] }], "Ryuichi Sakamoto")).toBe("s");
  });
});

describe("pickLinks", () => {
  it("keeps the first Bandcamp, Instagram and Discogs links and the Wikidata item", () => {
    const rel = (type: string, resource: string) => ({ type, url: { resource } });
    const out = pickLinks([
      rel("social network", "https://twitter.com/x"),
      rel("social network", "https://www.instagram.com/kelela/"),
      rel("bandcamp", "https://kelela.bandcamp.com/"),
      rel("bandcamp", "https://label.bandcamp.com/"),
      rel("discogs", "https://www.discogs.com/artist/123"),
      rel("wikidata", "https://www.wikidata.org/wiki/Q15982171"),
      rel("streaming", "https://open.spotify.com/artist/x"),
    ]);
    expect(out).toEqual({
      links: { instagram: "https://www.instagram.com/kelela/", bandcamp: "https://kelela.bandcamp.com/", discogs: "https://www.discogs.com/artist/123" },
      wikidata: "Q15982171",
    });
  });
});

describe("facts", () => {
  it("gives groups their active years and people none", () => {
    expect(facts({ id: "g", name: "Broadcast", type: "Group", area: { name: "United Kingdom" }, "begin-area": { name: "Birmingham" }, "life-span": { begin: "1995", end: "2011", ended: true } }))
      .toMatchObject({ type: "Group", area: "Birmingham", begin_year: 1995, end_year: 2011 });
    expect(facts({ id: "p", name: "Kelela", type: "Person", area: { name: "United States" }, "life-span": { begin: "1983-06-04" } }))
      .toMatchObject({ type: "Person", area: "United States", begin_year: null, end_year: null });
  });
});

describe("trimBio", () => {
  it("keeps the first two sentences within the limit", () => {
    expect(trimBio("One sentence here. Two sentences here. Three.")).toBe("One sentence here. Two sentences here.");
    expect(trimBio("A. " + "b".repeat(400) + ".")).toBe("A.");
  });
});

describe("cleanAnnotation", () => {
  it("turns MusicBrainz wiki markup into plain text", () => {
    const raw = "== Biography ==\nFine is a '''Copenhagen'''-based singer. She started in [https://example.com/chinah|Chinah].\n* Debut: ''Rocky Top Ballads''\n----\nSee [https://example.com]. <br/>Done.";
    expect(cleanAnnotation(raw)).toBe("Fine is a Copenhagen-based singer. She started in Chinah. Debut: Rocky Top Ballads See . Done.");
    expect(trimBio(cleanAnnotation(raw))).toBe("Fine is a Copenhagen-based singer. She started in Chinah.");
  });
});
