/*
 * Promotes an account to administrator.
 *
 * On an instance that predates roles, the migration promotes the earliest
 * account, because whoever set the server up is usually the first to sign in.
 * That guess is wrong whenever the earliest account is a leftover test one, and
 * there is no way to fix it from the app: administering requires an admin.
 *
 *   node scripts/make-admin.mjs                    # list accounts and roles
 *   node scripts/make-admin.mjs you@example.com    # promote that account
 *   node scripts/make-admin.mjs you@example.com --only   # and demote the rest
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Reads DATABASE_URL from the environment, falling back to .env then the default. */
function databasePath() {
  if (process.env.DATABASE_URL) return resolve(repoRoot, process.env.DATABASE_URL);
  const envFile = resolve(repoRoot, ".env");
  if (existsSync(envFile)) {
    const match = /^DATABASE_URL\s*=\s*(.+)$/m.exec(readFileSync(envFile, "utf8"));
    if (match?.[1]) return resolve(repoRoot, match[1].trim());
  }
  return resolve(repoRoot, "data/chronoplot.sqlite");
}

const target = process.argv[2];
const only = process.argv.includes("--only");
const file = databasePath();

if (!existsSync(file)) {
  console.error(`No database at ${file}. Set DATABASE_URL if it lives elsewhere.`);
  process.exit(1);
}

const db = new Database(file);
const columns = db.prepare("PRAGMA table_info(users)").all().map((row) => row.name);
if (!columns.includes("role")) {
  console.error("This database has no role column yet. Start the server once so it migrates.");
  process.exit(1);
}

const list = () => {
  const users = db.prepare("SELECT email, name, role, created_at FROM users ORDER BY created_at").all();
  console.log(`${users.length} account(s) in ${file}:\n`);
  for (const user of users) {
    const when = new Date(Number(user.created_at)).toISOString().slice(0, 10);
    console.log(`  ${user.role === "admin" ? "ADMIN" : "user "}  ${user.email.padEnd(34)} ${when}  ${user.name}`);
  }
};

if (!target) {
  list();
  console.log("\nPass an email address to promote that account.");
  db.close();
  process.exit(0);
}

const email = target.trim().toLowerCase();
const user = db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(email);
if (!user) {
  console.error(`No account with the address ${email}.\n`);
  list();
  db.close();
  process.exit(1);
}

db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
if (only) db.prepare("UPDATE users SET role = 'user' WHERE id <> ?").run(user.id);

console.log(`${user.email} is now an administrator${only ? ", and every other account is not" : ""}.\n`);
list();
db.close();
