import { describe, expect, it } from "vitest";
import { isPlaceholder, normText, slugify, splitArtists, splitTitle, trackKey } from "./normalize.ts";

describe("normText", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normText("Beyoncé — Halo!")).toBe("beyonce halo");
  });
  it("keeps non-Latin scripts", () => {
    expect(normText("石占 = Ishiura")).toBe("石占 ishiura");
  });
  it("does not collapse punctuation-only titles to empty", () => {
    expect(normText("???")).toBe("???");
  });
});

describe("splitArtists", () => {
  it("splits comma-separated collaborators", () => {
    expect(splitArtists("Robin Guthrie, Harold Budd").main).toEqual(["Robin Guthrie", "Harold Budd"]);
  });
  it("leaves slashes without spaces alone", () => {
    expect(splitArtists("V/Vm").main).toEqual(["V/Vm"]);
  });
  it("keeps allow-listed bands whole", () => {
    expect(splitArtists("Earth, Wind & Fire").main).toEqual(["Earth, Wind & Fire"]);
    expect(splitArtists("Simon & Garfunkel").main).toEqual(["Simon & Garfunkel"]);
  });
  it("keeps 'X & The Y' and 'X, The Y' bands whole", () => {
    expect(splitArtists("Echo & The Bunnymen").main).toEqual(["Echo & The Bunnymen"]);
    expect(splitArtists("Tyler, The Creator").main).toEqual(["Tyler, The Creator"]);
    expect(splitArtists("Bob Marley & The Wailers, Lee Perry").main).toEqual(["Bob Marley & The Wailers", "Lee Perry"]);
    expect(splitArtists("Tyler, The Creator, Kali Uchis").main).toEqual(["Tyler, The Creator", "Kali Uchis"]);
  });
  it("splits ', The X' when it is a second artist", () => {
    expect(splitArtists("Kevin Richard Martin, The Bug").main).toEqual(["Kevin Richard Martin", "The Bug"]);
  });
  it("separates inline and bracketed features", () => {
    expect(splitArtists("Mavado feat. Popcaan", "Listening Advisory")).toEqual({ main: ["Mavado"], featured: ["Popcaan"] });
    expect(splitArtists("Burial", "Untrue (feat. Four Tet & Thom Yorke)")).toEqual({
      main: ["Burial"],
      featured: ["Four Tet", "Thom Yorke"],
    });
  });
  it("splits ' x ' collabs but not names ending in X", () => {
    expect(splitArtists("Sherelle x Kode9").main).toEqual(["Sherelle", "Kode9"]);
    expect(splitArtists("Malcolm X").main).toEqual(["Malcolm X"]);
  });
});

describe("splitTitle", () => {
  it("removes feat credits but keeps remix tags", () => {
    expect(splitTitle("Tune (feat. MC) [Dub Mix]").title).toBe("Tune [Dub Mix]");
  });
});

describe("trackKey", () => {
  it("is stable across credit order, case, accents and feat placement", () => {
    expect(trackKey("Harold Budd, Robin Guthrie", "How Close Your Soul")).toBe(
      trackKey("robin guthrie & harold budd", "How Close Your Soul"),
    );
    expect(trackKey("A feat. B", "Song")).toBe(trackKey("A", "Song (feat. B)"));
  });
  it("distinguishes remixes", () => {
    expect(trackKey("A", "Song")).not.toBe(trackKey("A", "Song (B Remix)"));
  });
});

describe("isPlaceholder", () => {
  it("flags unidentified rows", () => {
    expect(isPlaceholder("Unknown Artist", "Unknown Track")).toBe(true);
    expect(isPlaceholder("ID", "ID")).toBe(true);
    expect(isPlaceholder("Various Artists", "Some Comp Track")).toBe(true);
    expect(isPlaceholder("Burial", "?")).toBe(true);
  });
  it("keeps real records, including ones titled Untitled", () => {
    expect(isPlaceholder("Coil", "Panic")).toBe(false);
    expect(isPlaceholder("The Moon Lay Hidden Beneath A Cloud", "Untitled")).toBe(false);
  });
});

describe("slugify", () => {
  it("makes URL-safe slugs and returns empty for non-Latin", () => {
    expect(slugify("Sly & The Family Stone")).toBe("sly-and-the-family-stone");
    expect(slugify("坂本龍一")).toBe("");
  });
});
