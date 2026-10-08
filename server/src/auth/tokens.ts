import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import type { ApiTokenRow, UserRole } from "../db/schema.js";

/*
 * API tokens, for clients that are not a browser.
 *
 * Modelled on the session tokens deliberately: a long random value, stored only
 * as its SHA-256, so a database leak yields nothing usable. The differences are
 * that these are named, long-lived, listed, revocable, and can be scoped to a
 * single project.
 */

/**
 * Recognisable on sight and greppable if one ever leaks into a log or a paste.
 * Secret scanners key off prefixes like this too.
 */
const PREFIX = "cpt_";

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface TokenBearer {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Set when the token may only touch one project. */
  projectId: string | null;
  tokenId: string;
}

export interface CreatedToken {
  id: string;
  /** The only time the caller ever sees this. */
  token: string;
}

export async function createApiToken(
  db: Db,
  input: { userId: string; name: string; projectId?: string | null; expiresInDays?: number | null },
): Promise<CreatedToken> {
  const id = randomUUID();
  const token = PREFIX + randomBytes(32).toString("base64url");

  await db.run(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, project_id, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      id,
      input.userId,
      input.name.trim(),
      digest(token),
      input.projectId ?? null,
      Date.now(),
      input.expiresInDays ? Date.now() + input.expiresInDays * 86_400_000 : null,
    ],
  );

  return { id, token };
}

/**
 * Resolves a bearer token to the account behind it.
 *
 * Returns undefined for anything that is not a live token - unknown, expired,
 * or belonging to a deleted account - without distinguishing between them.
 */
export async function resolveApiToken(
  db: Db,
  header: string | undefined,
): Promise<TokenBearer | undefined> {
  if (!header) {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1];
  if (!token || !token.startsWith(PREFIX)) {
    return undefined;
  }

  const row = await db.get<
    ApiTokenRow & { email: string; name: string; user_name: string; role: UserRole }
  >(
    `SELECT t.id, t.user_id, t.project_id, t.expires_at,
            u.email AS email, u.name AS user_name, u.role AS role
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?`,
    [digest(token)],
  );
  if (!row) {
    return undefined;
  }

  const expiresAt = row.expires_at === null ? null : Number(row.expires_at);
  if (expiresAt !== null && expiresAt <= Date.now()) {
    // Tidy it away as it is found; there is no reason to keep a dead token.
    await db.run(`DELETE FROM api_tokens WHERE id = ?`, [row.id]);
    return undefined;
  }

  /*
   * Recorded so an unused token can be spotted and revoked. Written on every
   * request, which is one extra write per call - acceptable because these
   * clients sync occasionally, not per keystroke like the editor does.
   */
  await db.run(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, [Date.now(), row.id]);

  return {
    id: row.user_id,
    email: row.email,
    name: row.user_name,
    role: row.role ?? "user",
    projectId: row.project_id,
    tokenId: row.id,
  };
}

export async function listApiTokens(db: Db, userId: string) {
  const rows = await db.all<ApiTokenRow & { project_title: string | null }>(
    `SELECT t.*, p.title AS project_title
       FROM api_tokens t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ?
      ORDER BY t.created_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    projectTitle: row.project_title,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
  }));
}

export async function revokeApiToken(db: Db, userId: string, tokenId: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    `SELECT id FROM api_tokens WHERE id = ? AND user_id = ?`,
    [tokenId, userId],
  );
  if (!row) {
    return false;
  }

  await db.run(`DELETE FROM api_tokens WHERE id = ?`, [tokenId]);
  return true;
}
