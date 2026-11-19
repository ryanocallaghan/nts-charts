// Related artists, similar shows, tastemakers and year reviews, against a small database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../../ingest/db.ts";
import { connectionsGraph } from "./series.ts";

const dir = mkdtempSync(join(tmpdir(), "nts-connections-"));
let q: typeof import("./queries.ts");

beforeAll(async () => {
  const path = join(dir, "test.sqlite");
  const db = openDb(path);
  // Artist 1 shares 4 episodes with artist 2 (who is in only those) and 4 with artist 3 (who is in 20):
  // 2 is the closer relation. Artist 4 shares only 2, below the minimum of 3.
  db.exec(`
    INSERT INTO shows(alias, name) VALUES ('a', 'Show A'), ('b', 'Show B');
    INSERT INTO artists(id, norm_name, name, slug) VALUES (1, 'one', 'One', 'one'), (2, 'two', 'Two', 'two'), (3, 'three', 'Three', 'three'), (4, 'four', 'Four', 'four');
    INSERT INTO artist_stats(artist_id, episodes, first_at) VALUES (1, 6, '2024-01-01'), (2, 4, '2025-02-01'), (3, 20, '2015-01-01'), (4, 2, '2025-03-01');
    INSERT INTO show_similar(show_key, other_key, score) VALUES ('a', 'b', 0.4);
    INSERT INTO early_plays(show_key, track_id, chart_week, played_at, weeks_early) VALUES
      ('a', 1, '2025-W10', '2025-02-01', 5), ('a', 2, '2025-W20', '2025-04-01', 7), ('b', 1, '2025-W10', '2025-02-20', 2);
    INSERT INTO tracks(id, norm_key, artist_display, title_display) VALUES (1, 'x', 'One', 'X'), (2, 'y', 'Two', 'Y');
    INSERT INTO meta(key, value) VALUES ('aggregated_at', 'test');
  `);
  const ep = db.prepare("INSERT INTO episodes(alias, show_alias, name, broadcast_at, track_count) VALUES (?, ?, ?, ?, 1)");
  const ea = db.prepare("INSERT INTO episode_artists(artist_id, episode_id) VALUES (?, (SELECT rowid FROM episodes WHERE alias = ?))");
  for (let i = 1; i <= 20; i++) {
    const alias = `e${i}`;
    ep.run(alias, i <= 10 ? "a" : "b", `Episode ${i}`, `2025-0${1 + (i % 9)}-1${i % 10}T20:00:00.000Z`);
    ea.run(3, alias);
    if (i <= 6) ea.run(1, alias);
    if (i <= 4) ea.run(2, alias);
    if (i === 5 || i === 6) ea.run(4, alias);
  }
  db.close();
  process.env.NTS_DB = path;
  q = await import("./queries.ts");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("relatedArtists", () => {
  it("scores shared episodes relative to both artists' totals, and needs 3 shared", () => {
    const r = q.relatedArtists(1);
    expect(r.map((a) => [a.slug, a.shared])).toEqual([["two", 4], ["three", 6]]);
    expect(r[0].score).toBeCloseTo(4 / Math.sqrt(6 * 4));
  });
});

describe("similarShows", () => {
  it("names and links the similar shows", () => {
    expect(q.similarShows("a")).toEqual([{ key: "b", name: "Show B", href: "/shows/b/", score: 0.4 }]);
    expect(q.similarShows("nope")).toEqual([]);
  });
});

describe("tastemakers", () => {
  it("ranks shows by tracks played before they charted", () => {
    expect(q.tastemakers(null).map((t) => [t.key, t.tracks, t.weeksEarly])).toEqual([["a", 2, 6], ["b", 1, 2]]);
    expect(q.tastemakers("2025-W15").map((t) => t.key)).toEqual(["a"]);
  });
  it("lists a show's early plays, latest first", () => {
    const e = q.showEarlyPlays("a");
    expect(e.tracks).toBe(2);
    expect(e.recent.map((t) => t.id)).toEqual([2, 1]);
  });
});

describe("yearReview", () => {
  it("finds artists new that year", () => {
    const y = q.yearReview("2025");
    expect(y.stats.newArtists).toBe(2);
    expect(y.newcomers.map((a) => a.slug)).toEqual(["two"]); // four has only 2 episodes that year
  });
});

describe("connectionsGraph", () => {
  it("links the artist to shows and related artists, and related artists to shows they share", () => {
    const g = connectionsGraph(
      { name: "One" },
      [{ key: "a", name: "Show A", href: "/shows/a/", episodes: 6 }],
      [{ id: 2, name: "Two", slug: "two", shared: 4 }],
      [{ artist: 2, show: "a", episodes: 4 }, { artist: 9, show: "a", episodes: 1 }],
    );
    expect(g.nodes!.map((n) => n.id)).toEqual(["self", "s:a", "a:2"]);
    expect(g.links).toEqual([
      { source: "self", target: "s:a", weight: 6 },
      { source: "self", target: "a:2", weight: 4 },
      { source: "a:2", target: "s:a", weight: 4 },
    ]);
  });
});
