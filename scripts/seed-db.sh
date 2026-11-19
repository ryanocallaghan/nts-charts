#!/bin/sh
# On the server, in ~/nts-charts: replace the site's database with the one in the db-latest release,
# then rebuild charts and search. The site is down for the swap and the rebuild (about 2 minutes).
#   sh scripts/seed-db.sh
set -eu
# Hold the same lock as the cron jobs, so nothing writes the database meanwhile.
if [ -z "${NTS_DB_LOCKED:-}" ]; then exec env NTS_DB_LOCKED=1 flock /tmp/nts-db.lock sh "$0" "$@"; fi

URL=https://github.com/ryanocallaghan/nts-charts/releases/download/db-latest/nts.sqlite.gz
mkdir -p seed
curl -fsSL --retry 5 -o seed/nts.sqlite.gz "$URL"
gzip -t seed/nts.sqlite.gz
ls -lh seed/nts.sqlite.gz

docker compose stop web
# The old -wal and -shm files belong to the old database: remove them before swapping it.
docker compose run --rm --no-deps -T -v "$PWD/seed:/seed:ro" web sh -c \
  'rm -f /data/nts.sqlite-wal /data/nts.sqlite-shm && gunzip -c /seed/nts.sqlite.gz > /data/nts.sqlite.new && mv /data/nts.sqlite.new /data/nts.sqlite && ls -lh /data'
docker compose run --rm --no-deps -T web node ingest/aggregate.ts
docker compose up -d web
rm -f seed/nts.sqlite.gz
