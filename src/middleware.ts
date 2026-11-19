// Cache headers for rendered pages, so Cloudflare serves most views and the server rarely renders
// the same page twice. Data changes twice a day; hashed assets under /_astro/ are cached for a
// year by the Node adapter itself.
import { defineMiddleware } from "astro:middleware";

const PAGE = "public, max-age=300, s-maxage=3600";
const MISSING = "public, max-age=60, s-maxage=300";

export const onRequest = defineMiddleware(async (_ctx, next) => {
  const res = await next();
  if (res.headers.has("cache-control")) return res;
  const value = res.status === 200 ? PAGE : res.status === 404 ? MISSING : res.status >= 500 ? "no-store" : null;
  if (!value) return res;
  try {
    res.headers.set("Cache-Control", value);
    return res;
  } catch {
    // Some responses (redirects) have immutable headers.
    const copy = new Response(res.body, res);
    copy.headers.set("Cache-Control", value);
    return copy;
  }
});
