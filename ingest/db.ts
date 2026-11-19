import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DB_PATH = process.env.NTS_DB ?? resolve(root, "data/nts.sqlite");

export function openDb(path = DB_PATH): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(resolve(root, "db/schema.sql"), "utf8"));
  db.exec("PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

/** Columns added after the first release, for databases created before them. */
function migrate(db: DatabaseSync) {
  const cols = new Set((db.prepare("PRAGMA table_info(episodes)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("guest_slug")) db.exec("ALTER TABLE episodes ADD COLUMN guest_slug TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS episodes_guest ON episodes(guest_slug) WHERE guest_slug IS NOT NULL");
  const info = new Set((db.prepare("PRAGMA table_info(artist_info)").all() as { name: string }[]).map((c) => c.name));
  if (info.size && !info.has("bio_source")) db.exec("ALTER TABLE artist_info ADD COLUMN bio_source TEXT");
}

/** Run fn inside a transaction, rolling back on error. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function getMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}
