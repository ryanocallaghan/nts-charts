// Search as you type: GET /api/search.json?q=kelela -> { status, results: [{ name, href, meta }] }
import type { APIRoute } from "astro";
import { search } from "../../lib/queries.ts";
import { searchStatus } from "../../lib/search.ts";

export const GET: APIRoute = ({ url }) => {
  const r = search((url.searchParams.get("q") ?? "").slice(0, 200));
  return Response.json({ status: searchStatus(r), results: r.results });
};
