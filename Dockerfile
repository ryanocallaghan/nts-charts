# Top of the NTS: the Astro server, plus ingest (run with `docker compose exec`).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    NTS_DB=/data/nts.sqlite \
    TZ=UTC
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# This build's hashed assets, copied into the nts-assets volume at start (scripts/start.sh), so
# earlier builds' assets stay available to pages Cloudflare cached before a deploy.
COPY --from=build /app/dist/client/_astro ./astro-build
# Ingest runs in this container too, and imports the shared SQL and helpers from src/lib.
COPY --from=build /app/ingest ./ingest
COPY --from=build /app/db ./db
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/src/scripts ./src/scripts
COPY --from=build /app/scripts ./scripts
# The database volume: SQLite needs the folder writable, for its -wal and -shm files.
RUN mkdir -p /data && chown node:node /data dist/client/_astro
USER node
VOLUME /data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/search/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["sh", "scripts/start.sh"]
