import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import type { SessionRow, UserRow } from "../db/schema.js";

export const SESSION_COOKIE = "cp_session";
export const CSRF_COOKIE = "cp_csrf";
export const CSRF_HEADER = "x-csrf-token";

/**
 * The cookie carries a raw random token; the database stores only its SHA-256.
 * A leaked database therefore cannot be replayed as a set of live logins.
 */
const digestToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * CSRF token derived from the session, so it needs no storage of its own and is
 * automatically invalidated when the session ends.
 */
export function csrfTokenFor(sessionToken: string): string {
  return createHmac("sha256", config.sessionSecret).update(digestToken(sessionToken)).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = createSessionToken();
  const now = Date.now();
  await db.run(
    `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    [digestToken(token), userId, now, now + config.sessionTtlMs],
  );
  return token;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function resolveSession(
  db: Db,
  token: string | undefined,
): Promise<SessionUser | undefined> {
  if (!token) return undefined;

  const id = digestToken(token);
  const row = await db.get<SessionRow & UserRow>(
    `SELECT s.id AS id, s.expires_at AS expires_at, u.id AS user_id, u.email AS email, u.name AS name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [id],
  );
  if (!row) return undefined;

  const expiresAt = Number((row as unknown as { expires_at: number }).expires_at);
  if (expiresAt <= Date.now()) {
    await db.run(`DELETE FROM sessions WHERE id = ?`, [id]);
    return undefined;
  }

  // Sliding expiry: an active user stays signed in, an idle one is timed out.
  // Only rewrite when it actually moved a while, to avoid a write per request.
  const nextExpiry = Date.now() + config.sessionTtlMs;
  if (nextExpiry - expiresAt > 1000 * 60 * 60) {
    await db.run(`UPDATE sessions SET expires_at = ? WHERE id = ?`, [nextExpiry, id]);
  }

  const user = row as unknown as { user_id: string; email: string; name: string };
  return { id: user.user_id, email: user.email, name: user.name };
}

export async function destroySession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.run(`DELETE FROM sessions WHERE id = ?`, [digestToken(token)]);
}

/** Drops expired rows. Called on boot and hourly. */
export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.run(`DELETE FROM sessions WHERE expires_at <= ?`, [Date.now()]);
}
