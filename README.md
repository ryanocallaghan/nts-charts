# Top of the NTS

Charts of the tracks and artists played on [NTS Radio](https://www.nts.live), built from the public episode tracklists.

A personal project, not affiliated with NTS.

## How it works

- `ingest/` crawls the NTS API into a SQLite database (`data/nts.sqlite`).
  - It finds every show and episode from the NTS sitemap, because the API's own pagination stops after about 1,000 items.
  - Tracks are matched by artist and title, then by ISRC. Artist credits are split into individual artists.
- Charts rank tracks and artists by the number of distinct episodes that played them in a week, month or year.
- `ingest/aggregate.ts` rebuilds the charts and the search index after each crawl.
- The most-played artists are matched to [MusicBrainz](https://musicbrainz.org) (by ISRC, or an exact unambiguous name) for facts, Bandcamp/Instagram/Discogs links and a short intro from Wikipedia or the MusicBrainz annotation (`ingest/enrich.ts`, at most 1 request per second).
- The site is an [Astro](https://astro.build) server that renders each page from the database when it's requested, so new data shows up as soon as it's aggregated. Every artist, show and repeat guest has a page. Pages are cached for an hour by Cloudflare in front.

## Running locally

Requires Node 24+. The project uses Node's built-in SQLite and TypeScript support, so there are no native dependencies.

```sh
npm install
npm test

# crawl a couple of shows into a scratch database
NTS_DB=data/smoke.sqlite node ingest/backfill.ts --shows helm,dj-swisha

# full archive crawl (resumable; about 14 hours at 2 requests/second)
node ingest/backfill.ts

# charts and search index
node ingest/aggregate.ts

# the site, reading data/nts.sqlite (or NTS_DB)
npm run dev
npm run build && npm start   # production server on HOST/PORT (default localhost:4321)
npm run smoke -- http://localhost:4321
```

## Running in Docker

`Dockerfile` builds the server; ingest runs in the same container. `docker-compose.yml` is for the production server: the database lives in the `nts-data` volume, and Caddy reaches the site on the shared `web` network.

```sh
docker network create web    # once
docker compose up -d --build
docker compose exec -T web node ingest/incremental.ts
docker compose exec -T web node ingest/aggregate.ts
```

## Data

The latest database is attached to the [`db-latest` release](../../releases/tag/db-latest) as `nts.sqlite.gz`. The **Backfill archive** workflow builds it in resumable chunks on GitHub Actions.
