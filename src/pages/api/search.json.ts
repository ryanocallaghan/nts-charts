// Search as you type: GET /api/search.json?q=kelela[&limit=8] -> { status, total, results: [{ name, href, meta }] }
import type { APIRoute } from "astro";
import { search } from "../../lib/queries.ts";
import { searchStatus } from "../../lib/search.ts";

export const GET: APIRoute = ({ url }) => {
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const r = search((url.searchParams.get("q") ?? "").slice(0, 200), limit);
  return Response.json({ status: searchStatus(r), total: r.total, results: r.results });
};
