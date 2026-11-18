// Names the search page can find, generated at build time (one small file instead of a per-page index).
import { searchIndex } from "../lib/queries.ts";

export function GET() {
  return new Response(JSON.stringify(searchIndex()), { headers: { "content-type": "application/json" } });
}
