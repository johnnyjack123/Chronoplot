/*
 * Rehearses a schema migration against a copy of a live database.
 *
 * Migrations run automatically on boot, which is convenient and also the reason
 * to rehearse them: by the time you find out one was wrong, it has already run
 * on the real data. This copies the database, lets you boot the server against
 * the copy, and then checks the result.
 *
 *   node scripts/check-migration.mjs copy    [source.sqlite] [copy.sqlite]
 *   # boot the server with DATABASE_URL pointing at the copy, then:
 *   node scripts/check-migration.mjs verify  [source.sqlite] [copy.sqlite]
 *
 * It never writes to the source.
 */
import Database from "better-sqlite3";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [phase = "copy", sourceArg, copyArg] = process.argv.slice(2);

const source = resolve(repoRoot, sourceArg ?? "data/chronoplot.sqlite");
const copy = resolve(repoRoot, copyArg ?? "backups/migration-rehearsal.sqlite");

if (phase === "copy") {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(copy + suffix)) rmSync(copy + suffix);
  }

  const db = new Database(source, { readonly: false });
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  const before = {
    users: db.prepare("SELECT count(*) AS c FROM users").get().c,
    projects: db.prepare("SELECT count(*) AS c FROM projects").get().c,
  };
  db.close();

  console.log(`source : ${source}`);
  console.log(`copy   : ${copy}`);
  console.log(`content: ${before.users} users, ${before.projects} projects`);
  console.log(`\nNow boot the server against the copy, for example:`);
  console.log(`  DATABASE_URL=${copy} PORT=5189 node server/dist/server/src/index.js`);
  process.exit(0);
}

/* ------------------------------------------------------------- verify -- */

const original = new Database(source, { readonly: true });
const expected = {
  users: original.prepare("SELECT count(*) AS c FROM users").get().c,
  projects: original.prepare("SELECT count(*) AS c FROM projects").get().c,
};
original.close();

const db = new Database(copy, { readonly: true });
const columns = db.prepare("PRAGMA table_info(users)").all().map((row) => row.name);
const users = db.prepare("SELECT email, role FROM users ORDER BY created_at").all();
const projects = db.prepare("SELECT count(*) AS c FROM projects").get().c;
const settings = db
  .prepare("SELECT key, value FROM app_settings")
  .all()
  .map((row) => `${row.key}=${row.value}`);
db.close();

const admins = users.filter((user) => user.role === "admin");

console.log(`users columns  : ${columns.join(", ")}`);
console.log(`users kept     : ${users.length} (expected ${expected.users})`);
console.log(`projects kept  : ${projects} (expected ${expected.projects})`);
console.log(`administrators : ${admins.length} - ${admins.map((a) => a.email).join(", ") || "none"}`);
console.log(`first account  : ${users[0]?.email} -> ${users[0]?.role}`);
console.log(`settings       : ${settings.join(", ") || "(none)"}`);

const checks = [
  ["role column added", columns.includes("role")],
  ["no users lost", users.length === expected.users],
  ["no projects lost", projects === expected.projects],
  ["exactly one administrator", admins.length === 1],
  ["the earliest account was promoted", users[0]?.role === "admin"],
  ["registration setting seeded", settings.some((entry) => entry.startsWith("allow_registration="))],
];

console.log("");
let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

console.log(failed === 0 ? "\nMIGRATION VERIFIED" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
