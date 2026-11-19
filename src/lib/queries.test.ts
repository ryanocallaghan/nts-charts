// The site's search query, against a small database built from db/schema.sql.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../../ingest/db.ts";
import { searchNorm } from "./search.ts";

const dir = mkdtempSync(join(tmpdir(), "nts-search-"));
let q: typeof import("./queries.ts");

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
    ["Rewind — Kelela", "track", "1-kelela-rewind", 5],
  ] as const) add.run(searchNorm(name), name, kind, key, eps);

  // A small archive: track 1 played on three episodes of two shows (one before NTS existed, which
  // doesn't count as its first play), and charting in two of the last three weeks.
  db.exec(`
    INSERT INTO shows(alias, name) VALUES ('helm', 'Helm'), ('later', 'Later Show');
    INSERT INTO episodes(alias, show_alias, name, broadcast_at, track_count) VALUES
      ('golden', 'helm', 'Golden Record', '1977-09-04T00:00:00.000Z', 1),
      ('helm-1', 'helm', 'Helm One', '2020-01-06T20:00:00.000Z', 1),
      ('later-1', 'later', 'Later One', '2021-03-01T20:00:00.000Z', 1);
    INSERT INTO tracks(id, norm_key, artist_display, title_display) VALUES (1, 'kelela|rewind', 'Kelela', 'Rewind');
    INSERT INTO plays(episode_alias, position, track_id) VALUES ('golden', 1, 1), ('helm-1', 1, 1), ('later-1', 1, 1);
    INSERT INTO chart_entries(period_type, period_key, entity_type, entity_id, rank, score, shows_count, status, periods_on_chart) VALUES
      ('week', '2021-W08', 'track', 1, 3, 2, 2, 'new', 1),
      ('week', '2021-W08', 'track', 2, 1, 2, 2, 'new', 1),
      ('week', '2021-W09', 'track', 2, 1, 2, 2, 'same', 2),
      ('week', '2021-W10', 'track', 1, 7, 2, 2, 'reentry', 2);
    INSERT INTO meta(key, value) VALUES ('aggregated_at', 'test');
  `);
  db.close();
  process.env.NTS_DB = path; // read by src/lib/db.ts when queries.ts is first imported
  q = await import("./queries.ts");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("search", () => {
  const search = (query: string, limit?: number) => q.search(query, limit);
  it("puts an exact name first, then names starting with the query, then the most played", () => {
    expect(search("kel").results.map((r) => r.name)).toEqual(["Kel", "Kelela", "Kelis", "Kelela X Bok Bok", "Rewind — Kelela"]);
    expect(search("kelela").results.map((r) => r.name)).toEqual(["Kelela", "Kelela X Bok Bok", "Rewind — Kelela"]);
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
  it("finds tracks by title and artist together", () => {
    expect(search("rewind kel").results[0]).toEqual({ name: "Rewind — Kelela", href: "/tracks/1-kelela-rewind/", meta: "Track · 5 episodes" });
  });
  it("caps the number of results but reports the total", () => {
    const r = search("kel", 2);
    expect(r.results).toHaveLength(2);
    expect(r.total).toBe(5);
  });
});

describe("trackDetail", () => {
  it("counts every dated episode, but takes the first play from NTS's own dates", () => {
    const d = q.trackDetail(1);
    expect(d.stats).toMatchObject({ episodes: 3, shows: 2, first: "2020-01-06T20:00:00.000Z", last: "2021-03-01T20:00:00.000Z" });
    expect(d.first?.by).toMatchObject({ name: "Helm", href: "/shows/helm/" });
    expect(d.first?.episode.name).toBe("Helm One");
  });
  it("lists episodes newest first and pages them", () => {
    expect(q.trackDetail(1).episodes.map((e) => e.episode)).toEqual(["later-1", "helm-1", "golden"]);
    expect(q.trackDetail(1, 2).episodes).toEqual([]);
  });
  it("lists shows by how often they played it", () => {
    expect(q.trackDetail(1).shows.map((s) => [s.name, s.episodes])).toEqual([["Helm", 2], ["Later Show", 1]]);
  });
});

describe("rankHistories", () => {
  it("gives each entry its rank in the last n charts, with gaps where it was off the chart", () => {
    const runs = q.rankHistories("week", "2021-W10", "track", [1, 2], 3);
    expect(runs.get(1)).toEqual([3, null, 7]);
    expect(runs.get(2)).toEqual([1, 1, null]);
  });
  it("stops at the chosen chart", () => {
    expect(q.rankHistories("week", "2021-W09", "track", [1], 8).get(1)).toEqual([3, null]);
  });
});
