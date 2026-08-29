/*
 * Deletes accounts by email address.
 *
 * Normally this belongs in the admin screen; this exists for the cases that
 * screen cannot reach - clearing out test accounts left over from a smoke run,
 * or tidying up before anyone has admin rights.
 *
 * Deleting an account takes its projects with it, so the default is a dry run
 * that shows exactly what would go. Nothing is removed without --yes.
 *
 *   node scripts/delete-accounts.mjs a@example.com b@example.com
 *   node scripts/delete-accounts.mjs a@example.com --yes
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function databasePath() {
  if (process.env.DATABASE_URL) return resolve(repoRoot, process.env.DATABASE_URL);
  const envFile = resolve(repoRoot, ".env");
  if (existsSync(envFile)) {
    const match = /^DATABASE_URL\s*=\s*(.+)$/m.exec(readFileSync(envFile, "utf8"));
    if (match?.[1]) return resolve(repoRoot, match[1].trim());
  }
  return resolve(repoRoot, "data/chronoplot.sqlite");
}

const apply = process.argv.includes("--yes");
const emails = process.argv.slice(2).filter((arg) => !arg.startsWith("--")).map((e) => e.trim().toLowerCase());

if (emails.length === 0) {
  console.error("Pass one or more email addresses.");
  process.exit(1);
}

const file = databasePath();
const db = new Database(file);
// Without this the ON DELETE CASCADE never fires and projects are orphaned
// rather than removed - better-sqlite3 leaves foreign keys off by default.
db.pragma("foreign_keys = ON");

const targets = [];
for (const email of emails) {
  const user = db.prepare("SELECT id, email, name, role FROM users WHERE email = ?").get(email);
  if (!user) {
    console.log(`skip    ${email} - no such account`);
    continue;
  }
  const projects = db
    .prepare("SELECT title FROM projects WHERE owner_id = ?")
    .all(user.id)
    .map((row) => row.title);
  targets.push({ ...user, projects });
}

if (targets.length === 0) {
  console.log("Nothing to do.");
  db.close();
  process.exit(0);
}

console.log(`${apply ? "Deleting" : "Would delete"} ${targets.length} account(s) from ${file}:\n`);
for (const target of targets) {
  console.log(`  ${target.email}  (${target.name}, ${target.role})`);
  for (const title of target.projects) console.log(`      + project "${title}"`);
}

const remainingAdmins = db
  .prepare(
    `SELECT count(*) AS c FROM users
      WHERE role = 'admin' AND email NOT IN (${targets.map(() => "?").join(",")})`,
  )
  .get(...targets.map((t) => t.email)).c;

if (remainingAdmins === 0) {
  console.error("\nRefusing: that would leave the instance with no administrator.");
  db.close();
  process.exit(1);
}

if (!apply) {
  console.log("\nDry run. Re-run with --yes to actually delete.");
  db.close();
  process.exit(0);
}

const remove = db.prepare("DELETE FROM users WHERE id = ?");
const run = db.transaction((rows) => {
  for (const row of rows) remove.run(row.id);
});
run(targets);

const left = db.prepare("SELECT count(*) AS c FROM users").get().c;
const projects = db.prepare("SELECT count(*) AS c FROM projects").get().c;
console.log(`\nDone. ${left} account(s) and ${projects} project(s) remain.`);
db.close();
