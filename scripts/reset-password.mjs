/*
 * Sets an account's password from the host.
 *
 * This is the way back in when nobody can sign in any more: every
 * administrator's password forgotten, or registration closed with no usable
 * account behind it. ALLOW_REGISTRATION is *not* that escape hatch - it is read
 * only when the stored setting does not exist yet, so flipping it on a running
 * instance changes nothing.
 *
 * Access to the database is the recovery credential, which for a self-hosted
 * app is the right one: whoever runs the server can always get back in, and
 * nobody else can.
 *
 *   node scripts/reset-password.mjs                       # list accounts
 *   node scripts/reset-password.mjs you@example.com       # set a generated one
 *   node scripts/reset-password.mjs you@example.com --password "..."
 *   node scripts/reset-password.mjs you@example.com --admin
 *
 * In Docker:
 *   docker compose exec chronoplot node scripts/reset-password.mjs you@example.com
 */
import Database from "better-sqlite3";
import { hash, Algorithm } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * Mirrors server/src/auth/password.ts. Duplicating these is safe: an argon2
 * hash encodes its own parameters, so `verify` reads them back out of the
 * stored string. A mismatch here would change only the cost of this one hash,
 * never whether the password works.
 */
const ARGON2 = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

function databasePath() {
  if (process.env.DATABASE_URL) {
    return resolve(repoRoot, process.env.DATABASE_URL);
  }
  const envFile = resolve(repoRoot, ".env");
  if (existsSync(envFile)) {
    const match = /^DATABASE_URL\s*=\s*(.+)$/m.exec(readFileSync(envFile, "utf8"));
    if (match?.[1]) {
      return resolve(repoRoot, match[1].trim());
    }
  }
  return resolve(repoRoot, "data/chronoplot.sqlite");
}

const args = process.argv.slice(2);
const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
const wantsAdmin = args.includes("--admin");
const explicit = args[args.indexOf("--password") + 1];
const chosen = args.includes("--password") ? explicit : undefined;

const file = databasePath();
if (!existsSync(file)) {
  console.error(`No database at ${file}. Set DATABASE_URL if it lives elsewhere.`);
  process.exit(1);
}

const db = new Database(file);
const hasRoles = db.prepare("PRAGMA table_info(users)").all().some((row) => row.name === "role");

const list = () => {
  const columns = hasRoles ? "email, name, role" : "email, name";
  const users = db.prepare(`SELECT ${columns} FROM users ORDER BY created_at`).all();
  console.log(`${users.length} account(s) in ${file}:\n`);
  for (const user of users) {
    const role = hasRoles ? (user.role === "admin" ? "ADMIN" : "user ") : "     ";
    console.log(`  ${role}  ${user.email.padEnd(34)} ${user.name}`);
  }
};

if (!email) {
  list();
  console.log("\nPass an email address to set that account's password.");
  db.close();
  process.exit(0);
}

const user = db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(email);
if (!user) {
  console.error(`No account with the address ${email}.\n`);
  list();
  db.close();
  process.exit(1);
}

if (chosen !== undefined && chosen.length < 10) {
  console.error("A password must be at least 10 characters, matching what the app enforces.");
  db.close();
  process.exit(1);
}

// Generated rather than prompted: it avoids a weak choice made under pressure,
// and avoids the password sitting in shell history as an argument.
const password = chosen ?? randomBytes(15).toString("base64url");

db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
  await hash(password, ARGON2),
  user.id,
);
if (wantsAdmin && hasRoles) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
}

// Any session opened with the old password has to die with it, or the reset
// achieves nothing against someone already signed in.
const removed = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id).changes;
db.close();

console.log(`Password set for ${user.email} (${user.name}).`);
if (wantsAdmin && hasRoles) {
  console.log("Promoted to administrator.");
}
if (!chosen) {
  console.log(`\n  ${password}\n`);
}
console.log(`${removed} existing session(s) signed out.`);
console.log("Sign in with it, then change it from the account screen.");
