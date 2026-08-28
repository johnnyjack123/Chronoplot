/*
 * Consistent single-file backup of the SQLite database.
 *
 * A plain file copy is not enough: with WAL journalling most recent commits
 * live in the -wal file, so a copy of just the .sqlite can be almost empty.
 * VACUUM INTO writes a single self-contained file with everything checkpointed,
 * and works safely while the server is running.
 *
 * Usage:  node scripts/backup-db.mjs [path/to/database.sqlite]
 *
 * Backups go to `backups/` next to the repo, or to CHRONOPLOT_BACKUP_DIR when
 * set - in a container the repo directory is not writable by the app user, and
 * a backup written inside the image would vanish with the container anyway.
 */
import Database from "better-sqlite3";
import { mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repoRoot, process.argv[2] ?? "data/chronoplot.sqlite");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = process.env.CHRONOPLOT_BACKUP_DIR
  ? resolve(process.env.CHRONOPLOT_BACKUP_DIR)
  : resolve(repoRoot, "backups");
const target = resolve(backupDir, `chronoplot_${stamp}.sqlite`);

mkdirSync(backupDir, { recursive: true });

const db = new Database(source, { readonly: false });
const counts = {
  users: db.prepare("SELECT count(*) AS c FROM users").get().c,
  projects: db.prepare("SELECT count(*) AS c FROM projects").get().c,
  shares: db.prepare("SELECT count(*) AS c FROM project_members").get().c,
};

// Escaping matters here: a single quote in the path would otherwise end the
// SQL string literal.
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

// Verify the backup independently rather than trusting that the write worked.
const check = new Database(target, { readonly: true });
const integrity = check.prepare("PRAGMA integrity_check").get().integrity_check;
const restored = {
  users: check.prepare("SELECT count(*) AS c FROM users").get().c,
  projects: check.prepare("SELECT count(*) AS c FROM projects").get().c,
  shares: check.prepare("SELECT count(*) AS c FROM project_members").get().c,
};
check.close();

const ok =
  integrity === "ok" &&
  restored.users === counts.users &&
  restored.projects === counts.projects &&
  restored.shares === counts.shares;

console.log(`source   : ${source}`);
console.log(`backup   : ${target} (${statSync(target).size} bytes)`);
console.log(`contents : ${counts.users} users, ${counts.projects} projects, ${counts.shares} shares`);
console.log(`integrity: ${integrity}`);
console.log(ok ? "VERIFIED - backup matches the source" : "MISMATCH - do not rely on this backup");

process.exit(ok ? 0 : 1);
