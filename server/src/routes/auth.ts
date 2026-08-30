import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { isRegistrationOpen, type UserRow } from "../db/schema.js";
import { HttpError } from "../http-error.js";
import { dummyVerify, hashPassword, verifyPassword } from "../auth/password.js";
import { clearAuthCookies, requireUser, setAuthCookies } from "../auth/plugin.js";
import { createSession, destroySession } from "../auth/session.js";
import { credentialsSchema, registerSchema } from "../shared.js";

/*
 * Per-account attempt tracking, on top of the per-IP limit the rate-limit
 * plugin applies. Without this, an attacker spread across many addresses could
 * grind one known account. In-memory is the right size for a self-hosted
 * instance; a multi-process deployment would move this into the database.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function assertNotLockedOut(email: string): void {
  const record = attempts.get(email);
  if (!record) return;
  if (Date.now() - record.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.delete(email);
    return;
  }
  if (record.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, "too_many_attempts", "Too many sign-in attempts. Try again later.");
  }
}

function recordFailure(email: string): void {
  const record = attempts.get(email);
  if (!record || Date.now() - record.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(email, { count: 1, firstAt: Date.now() });
  } else {
    record.count += 1;
  }
}

const normaliseEmail = (email: string) => email.trim().toLowerCase();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/me", async (request) => {
    const db = await getDb();
    const anyUser = await db.get<{ id: string }>(`SELECT id FROM users LIMIT 1`);

    return {
      user: request.user ?? null,
      allowRegistration: await isRegistrationOpen(db, config.allowRegistration),
      /*
       * True while the instance has no accounts at all. The browser uses it to
       * offer setting up the administrator instead of asking someone to sign in
       * to an instance that nobody can sign in to yet.
       */
      needsSetup: anyUser === undefined,
    };
  });

  app.post("/api/auth/register", async (request, reply) => {
    const db = await getDb();

    /*
     * The very first account always gets in, even with registration closed -
     * otherwise a server started with ALLOW_REGISTRATION=false has no way to
     * ever create its administrator.
     */
    const anyUser = await db.get<{ id: string }>(`SELECT id FROM users LIMIT 1`);
    if (anyUser && !(await isRegistrationOpen(db, config.allowRegistration))) {
      throw new HttpError(403, "registration_closed", "Registration is closed on this server.");
    }

    const body = registerSchema.parse(request.body);
    const email = normaliseEmail(body.email);

    const existing = await db.get<UserRow>(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) {
      // Deliberately the same shape of error as a weak password rather than
      // "this address is taken", which would confirm who has an account here.
      throw new HttpError(409, "registration_failed", "That address cannot be registered.");
    }

    const id = randomUUID();
    const role = anyUser ? "user" : "admin";
    await db.run(
      `INSERT INTO users (id, email, name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, body.name.trim(), await hashPassword(body.password), role, Date.now()],
    );

    const token = await createSession(db, id);
    setAuthCookies(reply, token);
    return { user: { id, email, name: body.name.trim(), role } };
  });

  /** Changes the caller's own display name. */
  app.patch("/api/auth/profile", async (request) => {
    const user = requireUser(request);
    const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body);

    const db = await getDb();
    await db.run(`UPDATE users SET name = ? WHERE id = ?`, [body.name.trim(), user.id]);
    return { user: { ...user, name: body.name.trim() } };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = credentialsSchema.parse(request.body);
    const email = normaliseEmail(body.email);
    assertNotLockedOut(email);

    const db = await getDb();
    const user = await db.get<UserRow>(
      `SELECT id, email, name, password_hash, role FROM users WHERE email = ?`,
      [email],
    );

    if (!user) {
      // Spend comparable time so a missing account is not detectable by timing.
      await dummyVerify();
      recordFailure(email);
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    if (!(await verifyPassword(user.password_hash, body.password))) {
      recordFailure(email);
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    attempts.delete(email);
    const token = await createSession(db, user.id);
    setAuthCookies(reply, token);
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role ?? "user" },
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const db = await getDb();
    await destroySession(db, request.sessionToken);
    clearAuthCookies(reply);
    return { ok: true };
  });

  app.post("/api/auth/password", async (request, reply) => {
    const user = requireUser(request);
    const body = credentialsSchema
      .pick({ password: true })
      .extend({ currentPassword: credentialsSchema.shape.password })
      .parse(request.body);

    const db = await getDb();
    const row = await db.get<UserRow>(`SELECT password_hash FROM users WHERE id = ?`, [user.id]);
    if (!row || !(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw new HttpError(401, "invalid_credentials", "Current password is incorrect.");
    }

    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      await hashPassword(body.password),
      user.id,
    ]);

    // Changing a password ends every existing session - that is the whole point
    // of changing it after a suspected compromise - and the browser that made
    // the change is then issued a fresh one so it stays signed in.
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, [user.id]);
    setAuthCookies(reply, await createSession(db, user.id));
    return { ok: true };
  });
}
