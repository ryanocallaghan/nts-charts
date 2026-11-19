// Check a running site end to end: real pages, real 404s, trailing-slash redirects, search without JS.
//   node scripts/smoke.ts http://127.0.0.1:4321
//   node scripts/smoke.ts https://nts.ryanocallaghan.com
const base = (process.argv[2] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
let failed = 0;

async function check(path: string, expect: { status: number; contains?: string; location?: string; cached?: boolean }) {
  const res = await fetch(base + path, { redirect: "manual" });
  const body = res.status === 200 || res.status === 404 ? await res.text() : "";
  const problems: string[] = [];
  if (res.status !== expect.status) problems.push(`status ${res.status}, expected ${expect.status}`);
  if (expect.contains && !body.includes(expect.contains)) problems.push(`missing ${JSON.stringify(expect.contains)}`);
  if (expect.location && res.headers.get("location") !== expect.location) problems.push(`location ${res.headers.get("location")}`);
  if (expect.cached && !/s-maxage=\d+/.test(res.headers.get("cache-control") ?? "")) problems.push(`cache-control ${res.headers.get("cache-control")}`);
  console.log(`${problems.length ? "FAIL" : "ok  "} ${res.status} ${path}${problems.length ? ` — ${problems.join("; ")}` : ""}`);
  if (problems.length) failed++;
  return body;
}

const home = await check("/", { status: 200, cached: true });
const top = home.match(/href="(\/artists\/[^"/]+\/)"/)?.[1];
if (top) {
  await check(top, { status: 200, contains: "Most-played tracks", cached: true });
  await check(top.slice(0, -1), { status: 301, location: top });
} else {
  console.log("FAIL no artist link on the home page");
  failed++;
}

// An artist played on a single episode: one that used to be rendered in the browser.
type Api = { status: string; results: { href: string; meta: string }[] };
let rare: string | undefined;
for (const q of ["kelela", "aphex twin", "sun ra", "bjork"]) {
  const api = (await fetch(`${base}/api/search.json?q=${encodeURIComponent(q)}`).then((r) => r.json())) as Api;
  if (!api.results.length) { console.log(`FAIL search API returned nothing for ${JSON.stringify(q)}`); failed++; continue; }
  rare = api.results.find((r) => r.href.startsWith("/artists/") && r.meta.endsWith(" 1 episode"))?.href;
  if (rare) { console.log(`ok   search API: ${JSON.stringify(q)} -> ${api.status}`); break; }
}
if (rare) await check(rare, { status: 200, contains: "Recent plays" });
else console.log("skip no single-episode artist found to check");

await check("/artists/no-such-artist-zz9/", { status: 404, contains: "Page not found" });
await check("/shows/no-such-show-zz9/", { status: 404 });
await check("/shows/guests/no-such-guest-zz9/", { status: 404 });
await check("/charts/week/1999-W01/", { status: 404 });
await check("/charts/nonsense/2026/", { status: 404 });
await check("/charts/", { status: 200, cached: true });
await check("/charts/all/", { status: 200 });
await check("/shows/", { status: 200 });
await check("/shows/guests/", { status: 200, contains: "Repeat guests" });
await check("/search/?q=aphex+twin", { status: 200, contains: 'href="/artists/aphex-twin/"' });
await check("/search?q=aphex", { status: 301, location: "/search/?q=aphex" });

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
