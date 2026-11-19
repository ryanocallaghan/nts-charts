// Read-only database handle for the site. Ingest writes in another process; with WAL, each query
// sees the latest committed data. The folder must stay writable for SQLite's -shm file.
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const path = process.env.NTS_DB ?? resolve(process.cwd(), "data/nts.sqlite");
let db: DatabaseSync | undefined;
function handle(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 5000");
  }
  return db;
}

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return handle().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return handle().prepare(sql).get(...params) as T | undefined;
}

// Results that only change when ingest/aggregate.ts runs, kept until it next does.
let version: string | null | undefined;
const memos = new Map<string, unknown>();

/** fn's result, cached until the charts are next rebuilt (meta.aggregated_at changes). Only for bounded keys. */
export function memo<T>(key: string, fn: () => T): T {
  const v = get<{ value: string }>("SELECT value FROM meta WHERE key = 'aggregated_at'")?.value ?? null;
  if (v !== version) {
    memos.clear();
    version = v;
  }
  if (!memos.has(key)) memos.set(key, fn());
  return memos.get(key) as T;
}
