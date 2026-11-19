import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Pages render on request from data/nts.sqlite (or NTS_DB), so new data shows up after each ingest
// without a rebuild. Cloudflare caches the HTML in front (see src/middleware.ts).
export default defineConfig({
  site: "https://nts.ryanocallaghan.com",
  output: "server",
  adapter: node({ mode: "standalone" }),
  trailingSlash: "always",
  build: { format: "directory" },
  vite: { ssr: { external: ["node:sqlite"] } },
});
