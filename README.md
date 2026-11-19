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

## On the server

The site runs at https://nts.ryanocallaghan.com on a VPS it shares with [MY BIN.DAY](https://mybin.day), as its own Docker Compose project in `~/nts-charts`. It's capped at 768 MB of memory and one CPU, so it can't slow the other site down. That project's Caddy serves it over the shared `web` network, behind Cloudflare.

```sh
# set up (once)
docker network create web
git clone https://github.com/ryanocallaghan/nts-charts.git ~/nts-charts && cd ~/nts-charts
docker compose up -d --build
sh scripts/seed-db.sh             # the database from the db-latest release, then charts and search

# update the code
git pull && docker compose up -d --build
npm run smoke -- https://nts.ryanocallaghan.com   # from a computer with the repo
```

Cron on the server, in UK time, kept clear of MY BIN.DAY's jobs (2pm, 6pm and early Sunday). Every database writer takes the same `flock`, so they never overlap:

```
15 10,22 * * * cd ~/nts-charts && flock -n /tmp/nts-db.lock sh -c 'docker compose exec -T web node ingest/incremental.ts && docker compose exec -T web node ingest/aggregate.ts' > /tmp/nts-update.log 2>&1
0 23 * * * cd ~/nts-charts && flock -n /tmp/nts-db.lock docker compose exec -T web node ingest/enrich.ts --max-minutes 90 > /tmp/nts-enrich.log 2>&1
0 11 * * 1 cd ~/nts-charts && sh scripts/backup-db.sh > /tmp/nts-backup.log 2>&1
```

The weekly backup keeps the last four copies in `~/backups` and uploads one to the `db-latest` release. It needs the GitHub CLI (`sudo apt install gh`), signed in once with `gh auth login --with-token` using a fine-grained token for this repository with **Contents: read and write**.

**Analytics.** Visits are counted, without cookies, by the [Umami](https://umami.is) that MY BIN.DAY runs on the same server: one dashboard at https://stats.mybin.day, with this site as a second website there. Its script and the address visits are sent to are served from this site (`/s/app.js`, see that project's `deploy/Caddyfile`), so ad blockers skip them more often. Put the website ID from Umami in `~/nts-charts/.env` as `UMAMI_WEBSITE_ID=...` and run `docker compose up -d web`. Without it, pages have no analytics script. Page views are recorded without query strings, so searches and chart filters are counted as events instead (`src/scripts/analytics.ts`). The events are: Searched, Filtered chart, Search suggestion, Listen on NTS, Show more, Calendar year, Bump chart click and Connections click. To leave out your own visits, open `/ignore-me/` in each browser you use.

To crawl the whole archive again (rarely needed), run `docker compose exec -T web node ingest/backfill.ts --max-minutes 120` by hand, in the daytime and never across 5:30–6:30pm.

## Running in Docker

`Dockerfile` builds the server; ingest runs in the same container. `docker-compose.yml` is the production setup above: the database lives in the `nts-data` volume, and Caddy reaches the site on the shared `web` network.

## Data

A weekly copy of the database is attached to the [`db-latest` release](../../releases/tag/db-latest) as `nts.sqlite.gz`, uploaded by the server. `scripts/download-db.sh` fetches it into `data/` for local work. The server is the only thing that writes the database: GitHub Actions only runs the tests.
