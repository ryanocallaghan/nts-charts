#!/bin/sh
# On the server, in ~/nts-charts, weekly from cron: back up the database to ~/backups (the last 4 are
# kept) and upload it to the db-latest release as nts.sqlite.gz, so it's off the server too.
# Needs the GitHub CLI signed in with a token that can write this repo's releases (see README).
#   sh scripts/backup-db.sh
set -eu
# Hold the same lock as the cron jobs, so nothing writes the database meanwhile.
if [ -z "${NTS_DB_LOCKED:-}" ]; then exec env NTS_DB_LOCKED=1 flock /tmp/nts-db.lock sh "$0" "$@"; fi

mkdir -p ~/backups
out=~/backups/nts-$(date +%F).sqlite.gz
docker compose exec -T web node scripts/backup-db.ts
docker compose exec -T web sh -c 'gzip -c /data/backup.sqlite && rm /data/backup.sqlite' > "$out.part"
gzip -t "$out.part"
mv "$out.part" "$out"
ls -lh "$out"
ls -t ~/backups/nts-*.sqlite.gz | tail -n +5 | xargs -r rm

# The release asset must be called nts.sqlite.gz (scripts/seed-db.sh and download-db.sh fetch that name).
tmp=$(mktemp -d)
cp "$out" "$tmp/nts.sqlite.gz"
gh release upload db-latest "$tmp/nts.sqlite.gz" --clobber --repo ryanocallaghan/nts-charts
rm -r "$tmp"
echo "Uploaded to db-latest"
