import type { Db } from "./adapter.js";

/*
 * Schema DDL, written once and emitted for whichever driver is active.
 *
 * The only real dialect difference is the width of an epoch-millisecond
 * column: SQLite's INTEGER is already 64-bit, Postgres needs BIGINT.
 */

export type UserRole = "admin" | "user";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface ProjectRow {
  id: string;
  owner_id: string;
  title: string;
  doc: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  project_id: string | null;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
}

export type MemberRole = "owner" | "editor" | "viewer";

export interface MemberRow {
  project_id: string;
  user_id: string;
  role: MemberRole;
  created_at: number;
}

/**
 * Whether a column already exists.
 *
 * Migrations run on every boot against a database that may hold real data, so
 * each step has to be safe to repeat. `ADD COLUMN` is not.
 */
async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  if (db.driver === "postgres") {
    const row = await db.get(
      `SELECT 1 AS present FROM information_schema.columns
        WHERE table_name = ? AND column_name = ?`,
      [table, column],
    );
    return row !== undefined;
  }
  const rows = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

export async function migrate(db: Db, envAllowsRegistration = true): Promise<void> {
  const ts = db.driver === "postgres" ? "BIGINT" : "INTEGER";

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
       id            TEXT PRIMARY KEY,
       email         TEXT NOT NULL UNIQUE,
       name          TEXT NOT NULL,
       password_hash TEXT NOT NULL,
       created_at    ${ts} NOT NULL
     )`,

    `CREATE TABLE IF NOT EXISTS sessions (
       id         TEXT PRIMARY KEY,
       user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       created_at ${ts} NOT NULL,
       expires_at ${ts} NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id)`,
    `CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)`,

    `CREATE TABLE IF NOT EXISTS projects (
       id         TEXT PRIMARY KEY,
       owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       title      TEXT NOT NULL,
       doc        TEXT NOT NULL,
       version    INTEGER NOT NULL DEFAULT 1,
       created_at ${ts} NOT NULL,
       updated_at ${ts} NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON projects (owner_id)`,

    `CREATE TABLE IF NOT EXISTS project_members (
       project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       role       TEXT NOT NULL,
       created_at ${ts} NOT NULL,
       PRIMARY KEY (project_id, user_id)
     )`,
    `CREATE INDEX IF NOT EXISTS project_members_user_id_idx ON project_members (user_id)`,

    // Instance-wide settings, so things like "may people register?" can be
    // changed from the admin screen instead of by editing .env and restarting.
    `CREATE TABLE IF NOT EXISTS app_settings (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,

    /*
     * Tokens for clients that are not a browser - the Obsidian plugin, or a
     * script. Only the SHA-256 is stored, exactly as for sessions: a database
     * leak must not hand anyone a working token.
     *
     * project_id scopes a token to one project. Null means "everything its
     * owner can reach", which is convenient and worth avoiding for anything
     * that stores the token on disk.
     */
    `CREATE TABLE IF NOT EXISTS api_tokens (
       id           TEXT PRIMARY KEY,
       user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       name         TEXT NOT NULL,
       token_hash   TEXT NOT NULL UNIQUE,
       project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
       created_at   ${ts} NOT NULL,
       last_used_at ${ts},
       expires_at   ${ts}
     )`,
    `CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens (user_id)`,
  ];

  for (const statement of statements) {
    await db.run(statement);
  }

  /* ---------------------------------------------------------- additions -- */

  if (!(await hasColumn(db, "users", "role"))) {
    await db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  }

  /*
   * Somebody has to be able to administer the instance. On a fresh database the
   * first account to register becomes the admin; on one that predates roles,
   * the earliest account is promoted, since that is whoever set the server up.
   */
  const admin = await db.get<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (!admin) {
    const oldest = await db.get<{ id: string }>(
      `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`,
    );
    if (oldest) {
      await db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [oldest.id]);
    }
  }

  // Seed the registration setting so the row exists from the first boot rather
  // than appearing the first time somebody happens to read it.
  if ((await readSetting(db, SETTING_ALLOW_REGISTRATION)) === undefined) {
    await writeSetting(db, SETTING_ALLOW_REGISTRATION, envAllowsRegistration ? "true" : "false");
  }
}

/* ------------------------------------------------------------- settings -- */

export async function readSetting(db: Db, key: string): Promise<string | undefined> {
  const row = await db.get<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [key]);
  return row?.value;
}

export async function writeSetting(db: Db, key: string, value: string): Promise<void> {
  // Portable upsert: both drivers support ON CONFLICT on a primary key.
  await db.run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export const SETTING_ALLOW_REGISTRATION = "allow_registration";

/**
 * Registration is a stored setting, with the environment variable acting as the
 * initial value only. Otherwise a restart would silently undo a change made in
 * the admin screen.
 */
export async function isRegistrationOpen(db: Db, envDefault: boolean): Promise<boolean> {
  const stored = await readSetting(db, SETTING_ALLOW_REGISTRATION);
  if (stored === undefined) {
    await writeSetting(db, SETTING_ALLOW_REGISTRATION, envDefault ? "true" : "false");
    return envDefault;
  }
  return stored === "true";
}
