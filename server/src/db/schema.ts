import type { Db } from "./adapter.js";

/*
 * Schema DDL, written once and emitted for whichever driver is active.
 *
 * The only real dialect difference is the width of an epoch-millisecond
 * column: SQLite's INTEGER is already 64-bit, Postgres needs BIGINT.
 */

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
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

export type MemberRole = "owner" | "editor" | "viewer";

export interface MemberRow {
  project_id: string;
  user_id: string;
  role: MemberRole;
  created_at: number;
}

export async function migrate(db: Db): Promise<void> {
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
  ];

  for (const statement of statements) {
    await db.run(statement);
  }
}
