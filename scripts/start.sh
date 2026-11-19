#!/bin/sh
# The container's start command. Cloudflare keeps pages for up to an hour, so a page cached just before
# a deploy still asks for the previous build's scripts and styles. Their names are content-hashed, so
# every build's files are kept side by side in the nts-assets volume (dist/client/_astro): this build's
# are copied in (which also marks them as fresh), and files no build has used for 7 days are removed.
# A problem here must never stop the site starting, so it only warns.
dir=dist/client/_astro
cp -r astro-build/. "$dir"/ || echo "start.sh: couldn't copy this build's assets into $dir" >&2
find "$dir" -type f -mtime +7 -delete 2>/dev/null || true
exec node dist/server/entry.mjs
