import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import {
  SETTING_ALLOW_REGISTRATION, isRegistrationOpen, writeSetting, type UserRole, type UserRow,
} from "../db/schema.js";
import { HttpError } from "../http-error.js";
import { requireUser } from "../auth/plugin.js";
import { hashPassword } from "../auth/password.js";
import { credentialsSchema } from "../shared.js";

/*
 * Instance administration.
 *
 * Every handler goes through `requireAdmin` first. A non-admin gets 403 rather
 * than 404 here, unlike projects: the existence of an admin area is not a
 * secret, and pretending it is only confuses the person reading the error.
 */
function requireAdmin(request: FastifyRequest) {
  const user = requireUser(request);
  if (user.role !== "admin") {
    throw new HttpError(403, "admin_only", "This needs an administrator account.");
  }
  return user;
}

const roleSchema = z.enum(["admin", "user"]);

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------ settings -- */

  app.get("/api/admin/settings", async (request) => {
    requireAdmin(request);
    const db = await getDb();
    return { allowRegistration: await isRegistrationOpen(db, config.allowRegistration) };
  });

  app.put("/api/admin/settings", async (request) => {
    requireAdmin(request);
    const body = z.object({ allowRegistration: z.boolean() }).parse(request.body);

    const db = await getDb();
    await writeSetting(db, SETTING_ALLOW_REGISTRATION, body.allowRegistration ? "true" : "false");
    return { allowRegistration: body.allowRegistration };
  });

  /* --------------------------------------------------------------- users -- */

  app.get("/api/admin/users", async (request) => {
    requireAdmin(request);
    const db = await getDb();

    const users = await db.all<{
      id: string;
      email: string;
      name: string;
      role: UserRole;
      created_at: number;
      project_count: number;
    }>(
      `SELECT u.id, u.email, u.name, u.role, u.created_at,
              (SELECT count(*) FROM projects p WHERE p.owner_id = u.id) AS project_count
         FROM users u
        ORDER BY u.created_at ASC`,
    );

    return {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role ?? "user",
        createdAt: Number(user.created_at),
        projectCount: Number(user.project_count),
      })),
    };
  });

  app.post("/api/admin/users", async (request) => {
    requireAdmin(request);
    const body = credentialsSchema
      .extend({ name: z.string().min(1).max(120), role: roleSchema.default("user") })
      .parse(request.body);

    const db = await getDb();
    const email = body.email.trim().toLowerCase();

    const existing = await db.get<UserRow>(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) {
      throw new HttpError(409, "email_taken", "An account with that address already exists.");
    }

    const id = randomUUID();
    await db.run(
      `INSERT INTO users (id, email, name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, body.name.trim(), await hashPassword(body.password), body.role, Date.now()],
    );
    return { user: { id, email, name: body.name.trim(), role: body.role } };
  });

  app.post("/api/admin/users/:id/password", async (request) => {
    requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = credentialsSchema.pick({ password: true }).parse(request.body);

    const db = await getDb();
    const target = await db.get<UserRow>(`SELECT id FROM users WHERE id = ?`, [id]);
    if (!target) throw new HttpError(404, "user_not_found", "No such account.");

    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      await hashPassword(body.password),
      id,
    ]);
    // A reset password must lock out whoever was using the old one, or the
    // reset achieves nothing against a compromised account.
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, [id]);
    return { ok: true };
  });

  app.patch("/api/admin/users/:id", async (request) => {
    const admin = requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ role: roleSchema.optional(), name: z.string().min(1).max(120).optional() })
      .parse(request.body);

    const db = await getDb();
    const target = await db.get<UserRow>(`SELECT id, role FROM users WHERE id = ?`, [id]);
    if (!target) throw new HttpError(404, "user_not_found", "No such account.");

    if (body.role && body.role !== "admin" && target.role === "admin") {
      await assertNotLastAdmin(db, id, "demote");
    }
    if (body.role === "user" && id === admin.id) {
      throw new HttpError(400, "cannot_demote_self", "You cannot remove your own admin rights.");
    }

    if (body.role) await db.run(`UPDATE users SET role = ? WHERE id = ?`, [body.role, id]);
    if (body.name) await db.run(`UPDATE users SET name = ? WHERE id = ?`, [body.name.trim(), id]);
    return { ok: true };
  });

  app.delete("/api/admin/users/:id", async (request) => {
    const admin = requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    if (id === admin.id) {
      throw new HttpError(400, "cannot_delete_self", "You cannot delete your own account.");
    }

    const db = await getDb();
    const target = await db.get<UserRow>(`SELECT id, role FROM users WHERE id = ?`, [id]);
    if (!target) throw new HttpError(404, "user_not_found", "No such account.");
    if (target.role === "admin") await assertNotLastAdmin(db, id, "delete");

    // Projects and memberships cascade from the foreign keys, so this really
    // does remove everything the account owned.
    await db.run(`DELETE FROM users WHERE id = ?`, [id]);
    return { ok: true };
  });
}

/** Refuses to leave the instance with nobody who can administer it. */
async function assertNotLastAdmin(
  db: Awaited<ReturnType<typeof getDb>>,
  id: string,
  action: "delete" | "demote",
): Promise<void> {
  const others = await db.get<{ count: number }>(
    `SELECT count(*) AS count FROM users WHERE role = 'admin' AND id <> ?`,
    [id],
  );
  if (Number(others?.count ?? 0) === 0) {
    throw new HttpError(
      400,
      "last_admin",
      `This is the only administrator, so it cannot be ${action}d. Promote someone else first.`,
    );
  }
}
