// Filtered charts and genres, against a small database built from db/schema.sql.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../../ingest/db.ts";

const dir = mkdtempSync(join(tmpdir(), "nts-filters-"));
let q: typeof import("./queries.ts");

beforeAll(async () => {
  const path = join(dir, "test.sqlite");
  const db = openDb(path);
  // Track 1 is played in three House episodes from London in March; track 2 in two Jazz episodes
  // from Berlin; track 3 once. In February, track 2 was played twice in House episodes.
  db.exec(`
    INSERT INTO shows(alias, name) VALUES ('a', 'Show A'), ('b', 'Show B'), ('c', 'Show C');
    INSERT INTO episodes(alias, show_alias, name, broadcast_at, track_count, location) VALUES
      ('feb-1', 'a', 'Feb 1', '2021-02-02T20:00:00.000Z', 1, 'London'),
      ('feb-2', 'b', 'Feb 2', '2021-02-09T20:00:00.000Z', 1, 'London'),
      ('mar-1', 'a', 'Mar 1', '2021-03-02T20:00:00.000Z', 2, 'London'),
      ('mar-2', 'b', 'Mar 2', '2021-03-09T20:00:00.000Z', 2, 'London'),
      ('mar-3', 'c', 'Mar 3', '2021-03-16T20:00:00.000Z', 1, 'London'),
      ('mar-4', 'a', 'Mar 4', '2021-03-23T20:00:00.000Z', 1, 'Berlin'),
      ('mar-5', 'b', 'Mar 5', '2021-03-30T20:00:00.000Z', 1, 'Berlin');
    INSERT INTO artists(id, norm_name, name, slug) VALUES (1, 'one', 'One', 'one'), (2, 'two', 'Two', 'two'), (3, 'three', 'Three', 'three');
    INSERT INTO tracks(id, norm_key, artist_display, title_display) VALUES (1, 'one|a', 'One', 'A'), (2, 'two|b', 'Two', 'B'), (3, 'three|c', 'Three', 'C');
    INSERT INTO track_artists(track_id, artist_id) VALUES (1, 1), (2, 2), (3, 3);
    INSERT INTO plays(episode_alias, position, track_id) VALUES
      ('feb-1', 1, 2), ('feb-2', 1, 2),
      ('mar-1', 1, 1), ('mar-1', 2, 3), ('mar-2', 1, 1), ('mar-2', 2, 2), ('mar-3', 1, 1),
      ('mar-4', 1, 2), ('mar-5', 1, 2);
    INSERT INTO genres(slug, name, episodes, tracks) VALUES ('house', 'House', 5, 0), ('jazz', 'Jazz', 2, 1), ('downtempo', 'Downtempo', 0, 1);
    -- Record genres: track 2 is a Jazz and Downtempo record on Discogs; track 1 was looked up and not
    -- found; track 3 hasn't been looked up.
    INSERT INTO track_discogs(track_id, checked_at, found, url, release, styles_json, genres_json) VALUES
      (1, '2021-04-01', 0, NULL, NULL, NULL, NULL),
      (2, '2021-04-01', 1, 'https://www.discogs.com/master/2', 'Two - B', '["Downtempo"]', '["Jazz"]');
    INSERT INTO track_genres(genre_slug, track_id) VALUES ('jazz', 2), ('downtempo', 2);
    INSERT INTO episode_genres(genre_slug, episode_alias) VALUES
      ('house', 'feb-1'), ('house', 'feb-2'), ('house', 'mar-1'), ('house', 'mar-2'), ('house', 'mar-3'),
      ('jazz', 'mar-4'), ('jazz', 'mar-5');
    INSERT INTO genre_quarters(quarter, genre_slug, tags) VALUES ('2021-Q1', 'house', 5), ('2021-Q1', 'jazz', 2);
    -- The chart periods that exist (filtered charts step through the same keys as the main ones).
    INSERT INTO chart_entries(period_type, period_key, entity_type, entity_id, rank, score, shows_count, status, periods_on_chart) VALUES
      ('month', '2021-02', 'track', 2, 1, 2, 2, 'new', 1),
      ('month', '2021-03', 'track', 1, 1, 3, 3, 'new', 1);
    INSERT INTO meta(key, value) VALUES ('aggregated_at', 'test');
  `);
  db.close();
  process.env.NTS_DB = path; // read by src/lib/db.ts when queries.ts is first imported
  q = await import("./queries.ts");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

describe("filteredChart", () => {
  it("counts only episodes tagged with the genre", () => {
    const house = q.genreBySlug("house")!;
    const c = q.filteredChart("month", "2021-03", { genre: house, by: "shows" });
    expect(ids(c.tracks)).toEqual([1]); // track 2 had one House episode in March: below the minimum of 2
    expect(c.tracks[0]).toMatchObject({ rank: 1, score: 3, shows: 3, prevRank: null, status: "new" });
    expect(c.artists.map((a) => a.slug)).toEqual(["one"]);
  });
  it("counts only episodes broadcast from the place", () => {
    const c = q.filteredChart("month", "2021-03", { place: "Berlin" });
    expect(ids(c.tracks)).toEqual([2]);
  });
  it("combines genre and place", () => {
    expect(q.filteredChart("month", "2021-03", { genre: q.genreBySlug("jazz")!, by: "shows", place: "London" }).tracks).toEqual([]);
  });
  it("compares with the same filter's previous period", () => {
    const c = q.filteredChart("month", "2021-03", { place: "London" });
    expect(c.tracks.map((t) => [t.id, t.rank, t.status])).toEqual([[1, 1, "new"]]);
    // Track 2 was #1 from London in February, and charted again in March from anywhere.
    const all = q.filteredChart("month", "2021-03", { place: "Berlin" });
    expect(all.tracks[0]).toMatchObject({ id: 2, prevRank: null, status: "new" });
    const anywhere = q.filteredChart("month", "2021-03", {});
    expect(anywhere.tracks.find((t) => t.id === 2)).toMatchObject({ prevRank: 1, status: "down" });
  });
});

describe("record genres", () => {
  it("counts every play of the genre's records, whatever the show", () => {
    const c = q.filteredChart("month", "2021-03", { genre: q.genreBySlug("jazz")! });
    expect(c.tracks.map((t) => [t.id, t.score, t.shows])).toEqual([[2, 3, 2]]); // mar-2 (House), mar-4, mar-5
    expect(c.artists.map((a) => a.slug)).toEqual(["two"]);
  });
  it("doesn't use episode tags", () => {
    expect(q.filteredChart("month", "2021-03", { genre: q.genreBySlug("house")! }).tracks).toEqual([]);
  });
  it("combines with a place", () => {
    expect(ids(q.filteredChart("month", "2021-03", { genre: q.genreBySlug("downtempo")!, place: "Berlin" }).tracks)).toEqual([2]);
    expect(q.filteredChart("month", "2021-03", { genre: q.genreBySlug("downtempo")!, place: "London" }).tracks).toEqual([]);
  });
  it("says how much of the period's chartable music has a known genre", () => {
    // March: tracks 1 and 2 are in 2+ episodes; only 2 has genres; both were looked up.
    expect(q.recordGenreCoverage(new Date("2021-03-01"), new Date("2021-04-01"))).toEqual({ tracks: 2, known: 1, unchecked: 0 });
    expect(q.recordGenreCoverage(new Date("2022-01-01"), new Date("2022-02-01"))).toEqual({ tracks: 0, known: 0, unchecked: 0 });
  });
  it("gives a track's genres and release", () => {
    expect(q.trackGenres(2)).toMatchObject({ release: "Two - B", url: "https://www.discogs.com/master/2", genres: [{ slug: "downtempo" }, { slug: "jazz" }] });
    expect(q.trackGenres(1)).toBeNull();
    expect(q.trackGenres(3)).toBeNull();
  });
  it("labels the two kinds of genre filter", () => {
    const jazz = q.genreBySlug("jazz")!;
    expect(q.filterLabel({ genre: jazz })).toBe("Jazz");
    expect(q.filterLabel({ genre: jazz, by: "shows", place: "Berlin" })).toBe("Jazz shows, from Berlin");
    expect(q.filterDescription({ genre: jazz, place: "Berlin" })).toBe("only Jazz records and episodes broadcast from Berlin");
    expect(q.filterDescription({ genre: jazz, by: "shows" })).toBe("only episodes tagged Jazz");
  });
});

describe("windowChart", () => {
  it("ranks over any date range, ties going to more shows", () => {
    const w = q.windowChart({ genre: q.genreBySlug("house")!, by: "shows" }, new Date("2021-02-01"), new Date("2021-04-01"));
    expect(w.tracks.map((t) => [t.id, t.score, t.shows])).toEqual([[1, 3, 3], [2, 3, 2]]);
  });
});

describe("genres", () => {
  it("lists genres biggest first and finds them by slug", () => {
    expect(q.allGenres().map((g) => g.slug)).toEqual(["house", "jazz", "downtempo"]);
    expect(q.genreBySlug("nope")).toBeUndefined();
  });
  it("gives each top genre's share of the quarter's tags", () => {
    const r = q.genreRiver(1);
    expect(r.quarters).toEqual(["2021-Q1"]);
    expect(r.series).toEqual([{ name: "House", slug: "house", values: [71.4] }]);
    expect(r.others).toBe(1);
  });
});
