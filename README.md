# Top of the NTS

Charts of the tracks and artists played on [NTS Radio](https://www.nts.live), built from the public episode tracklists.

A personal project, not affiliated with NTS.

## How it works

- `ingest/` crawls the NTS API into a SQLite database (`data/nts.sqlite`).
  - It finds every show and episode from the NTS sitemap, because the API's own pagination stops after about 1,000 items.
  - Tracks are matched by artist and title, then by ISRC. Artist credits are split into individual artists.
- Charts rank tracks and artists by the number of distinct episodes that played them in a week, month or year.
- The site is static and rebuilt from the database on a schedule.

## Running locally

Requires Node 24+. The project uses Node's built-in SQLite and TypeScript support, so there are no native dependencies.

```sh
npm install
npm test

# crawl a couple of shows into a scratch database
NTS_DB=data/smoke.sqlite node ingest/backfill.ts --shows helm,dj-swisha

# full archive crawl (resumable; about 14 hours at 2 requests/second)
node ingest/backfill.ts
```

## Data

The latest database is attached to the [`db-latest` release](../../releases/tag/db-latest) as `nts.sqlite.gz`. The **Backfill archive** workflow builds it in resumable chunks on GitHub Actions.
