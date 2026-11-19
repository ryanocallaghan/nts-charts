#!/usr/bin/env bash
# Download the database from the $DB_RELEASE release into data/nts.sqlite.
#   download-db.sh            # the database must exist
#   download-db.sh --init     # create the release and start empty if (and only if) it doesn't exist yet
# Retries ride out the moment while another job replaces the asset (--clobber deletes then uploads).
set -euo pipefail
DB_RELEASE="${DB_RELEASE:-db-latest}"
mkdir -p data
rm -f data/nts.sqlite data/nts.sqlite.gz

if ! gh release view "$DB_RELEASE" >/dev/null 2>&1; then
  if [ "${1:-}" = "--init" ]; then
    gh release create "$DB_RELEASE" --title "Database" --latest=false \
      --notes "SQLite database of NTS tracklists, updated automatically."
    echo "Created release $DB_RELEASE; starting with an empty database."
    exit 0
  fi
  echo "::error::Release $DB_RELEASE not found"
  exit 1
fi

for attempt in 1 2 3 4 5 6; do
  if gh release download "$DB_RELEASE" --pattern nts.sqlite.gz --dir data --clobber && [ -s data/nts.sqlite.gz ]; then
    gunzip -f data/nts.sqlite.gz
    ls -lh data/nts.sqlite
    exit 0
  fi
  echo "Download attempt $attempt failed; retrying in 20s…"
  sleep 20
done

# Never fall back to an empty database: a later upload would overwrite the archive.
echo "::error::Could not download nts.sqlite.gz from $DB_RELEASE"
exit 1
