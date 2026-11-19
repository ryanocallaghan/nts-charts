// The site's search query, against a small database built from db/schema.sql.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../../ingest/db.ts";
import { searchNorm } from "./search.ts";

const dir = mkdtempSync(join(tmpdir(), "nts-search-"));
let search: typeof import("./queries.ts").search;

beforeAll(async () => {
  const path = join(dir, "test.sqlite");
  const db = openDb(path);
  const add = db.prepare("INSERT INTO search_index(norm, name, kind, key, episodes) VALUES (?, ?, ?, ?, ?)");
  for (const [name, kind, key, eps] of [
    ["Kelela", "artist", "kelela", 900],
    ["Kelela X Bok Bok", "artist", "kelela-x-bok-bok", 2],
    ["Kel", "artist", "kel", 6],
    ["Kelis", "artist", "kelis", 370],
    ["Björk", "artist", "bjork", 650],
    ["The Do!! You!!! Breakfast Show", "show", "breakfast", 1400],
    ["Moxie", "guest", "moxie", 3],
  ] as const) add.run(searchNorm(name), name, kind, key, eps);
  db.close();
  process.env.NTS_DB = path; // read by src/lib/db.ts when queries.ts is first imported
  ({ search } = await import("./queries.ts"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("search", () => {
  it("puts an exact name first, then names starting with the query, then the most played", () => {
    expect(search("kel").results.map((r) => r.name)).toEqual(["Kel", "Kelela", "Kelis", "Kelela X Bok Bok"]);
    expect(search("kelela").results.map((r) => r.name)).toEqual(["Kelela", "Kelela X Bok Bok"]);
  });
  it("needs every word to start a word in the name", () => {
    expect(search("kel bok").results.map((r) => r.name)).toEqual(["Kelela X Bok Bok"]);
    expect(search("bok kel").total).toBe(1);
    expect(search("kel zz").total).toBe(0);
  });
  it("ignores accents, case and punctuation", () => {
    expect(search("BJORK").results[0]?.name).toBe("Björk");
    expect(search("do you").results[0]).toEqual({ name: "The Do!! You!!! Breakfast Show", href: "/shows/breakfast/", meta: "Show · 1,400 episodes" });
  });
  it("links guests and counts their mixes", () => {
    expect(search("mox").results).toEqual([{ name: "Moxie", href: "/shows/guests/moxie/", meta: "Guest · 3 mixes" }]);
  });
  it("asks for more than one letter", () => {
    expect(search("k")).toEqual({ short: true, total: 0, results: [] });
    expect(search("  ")).toEqual({ short: false, total: 0, results: [] });
  });
  it("treats query syntax as plain text", () => {
    expect(() => search('kel" OR * NEAR(')).not.toThrow();
    expect(search('"kelis"').results.map((r) => r.name)).toEqual(["Kelis"]);
  });
  it("caps the number of results but reports the total", () => {
    const r = search("kel", 2);
    expect(r.results).toHaveLength(2);
    expect(r.total).toBe(4);
  });
});
