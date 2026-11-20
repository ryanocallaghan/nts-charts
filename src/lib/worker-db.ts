// Read-only queries in a worker thread (scripts/rank-worker.mjs), for rankings slow enough to stall
// the site if they ran on the main thread (node:sqlite blocks while a query runs).
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

type Param = string | number | null;
interface Waiting { resolve: (rows: unknown[]) => void; reject: (err: Error) => void }

let worker: Worker | null = null;
const waiting = new Map<number, Waiting>();
let nextId = 0;

function failAll(err: Error) {
  for (const w of waiting.values()) w.reject(err);
  waiting.clear();
  worker = null;
}

function start(): Worker {
  // A path rather than new URL(..., import.meta.url), so the build leaves it alone; the server runs from the repo root.
  const w = new Worker(resolve(process.cwd(), "scripts/rank-worker.mjs"));
  w.on("message", (m: { id: number; rows?: unknown[]; error?: string }) => {
    const job = waiting.get(m.id);
    if (!job) return;
    waiting.delete(m.id);
    if (m.error) job.reject(new Error(m.error));
    else job.resolve(m.rows ?? []);
  });
  w.on("error", (err: Error) => failAll(err));
  w.on("exit", (code: number) => failAll(new Error(`rank worker exited (${code})`)));
  w.unref(); // don't keep the process (or a test run) alive for it
  return w;
}

/** Rows of a read-only query, run in the worker after any queries already waiting. */
export function allInWorker<T>(sql: string, ...params: Param[]): Promise<T[]> {
  worker ??= start();
  const id = nextId++;
  return new Promise<T[]>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (rows: unknown[]) => void, reject });
    worker!.postMessage({ id, sql, params });
  });
}
