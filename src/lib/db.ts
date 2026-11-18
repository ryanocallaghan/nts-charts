// Read-only database handle used at build time.
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const path = process.env.NTS_DB ?? resolve(process.cwd(), "data/nts.sqlite");
const db = new DatabaseSync(path, { readOnly: true });

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
