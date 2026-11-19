// Inside the container: write a consistent copy of the live database to /data/backup.sqlite
// (VACUUM INTO, never a plain copy of a file that's being written). Used by scripts/backup-db.sh.
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = process.env.NTS_DB ?? "/data/nts.sqlite";
const out = "/data/backup.sqlite";
rmSync(out, { force: true });
const db = new DatabaseSync(src);
db.exec("PRAGMA busy_timeout = 30000");
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.prepare("VACUUM INTO ?").run(out);
db.close();
console.log(`Backed up ${src} to ${out}`);
