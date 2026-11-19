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

const track = home.match(/href="(\/tracks\/(\d+)-[^"/]+\/)"/);
if (track) {
  await check(track[1], { status: 200, contains: "First played on NTS by", cached: true });
  await check(`/tracks/${track[2]}/`, { status: 301, location: track[1] }); // the canonical slug
  await check(`${track[1]}?page=9999`, { status: 404 });
} else {
  console.log("FAIL no track link on the home page");
  failed++;
}
await check("/tracks/999999999-nothing/", { status: 404 });
await check("/tracks/not-a-track/", { status: 404 });
if (!home.includes('action="/search/"')) { console.log("FAIL no search box in the header"); failed++; }

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
// Genres and filtered charts.
const genres = await check("/genres/", { status: 200, contains: "The biggest genres over time", cached: true });
const genre = genres.match(/href="\/genres\/([^"/]+)\/"/)?.[1];
if (genre) {
  await check(`/genres/${genre}/`, { status: 200, contains: "Shows that tag it most" });
  const charts = await fetch(`${base}/charts/`).then((r) => r.text());
  const rolling = charts.match(/\/charts\/rolling\/(\d{4}-W\d\d)\//)?.[1] ?? home.match(/\/charts\/rolling\/(\d{4}-W\d\d)\//)?.[1];
  if (rolling) {
    await check(`/charts/rolling/${rolling}/?genre=${genre}&by=shows`, { status: 200, contains: "only episodes tagged" });
    await check(`/charts/rolling/${rolling}/?genre=${genre}`, { status: 200, contains: "only " });
    await check(`/charts/rolling/${rolling}/?genre=no-such-genre-zz9`, { status: 404 });
  }
}
await check("/genres/no-such-genre-zz9/", { status: 404 });

// Tastemakers and years.
await check("/tastemakers/", { status: 200, contains: "Last 12 months", cached: true });
const archive = await fetch(`${base}/charts/`).then((r) => r.text());
const year = archive.match(/href="\/years\/(\d{4})\/"/)?.[1];
if (year) await check(`/years/${year}/`, { status: 200, contains: "New to NTS" });
else { console.log("FAIL no year review link on the archive page"); failed++; }
await check("/years/1999/", { status: 404 });
if (top) await check(top, { status: 200, contains: "When it's played" });

await check("/search/?q=aphex+twin", { status: 200, contains: 'href="/artists/aphex-twin/"' });
await check("/search?q=aphex", { status: 301, location: "/search/?q=aphex" });

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
