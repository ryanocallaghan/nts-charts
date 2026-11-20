// Runs slow read-only queries (charts for any dates, /charts/range/) off the site's main thread, so a
// 3-year ranking doesn't hold up every other page. Queries run one at a time, in the order they arrive,
// so at most one CPU goes on them. Started by src/lib/worker-db.ts; plain JS so it runs as is.
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { parentPort } from "node:worker_threads";

const db = new DatabaseSync(process.env.NTS_DB ?? resolve(process.cwd(), "data/nts.sqlite"), { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

parentPort.on("message", ({ id, sql, params }) => {
  try {
    parentPort.postMessage({ id, rows: db.prepare(sql).all(...params) });
  } catch (err) {
    parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
