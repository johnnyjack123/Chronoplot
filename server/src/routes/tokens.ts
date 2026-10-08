import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { HttpError } from "../http-error.js";
import { requireSessionUser } from "../auth/plugin.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../auth/tokens.js";

/*
 * Managing one's own API tokens.
 *
 * Every route here requires a browser session rather than merely being
 * authenticated - see requireSessionUser for why a token must not be able to
 * mint tokens.
 */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tokens", async (request) => {
    const user = requireSessionUser(request);
    const db = await getDb();
    return { tokens: await listApiTokens(db, user.id) };
  });

  app.post("/api/tokens", async (request) => {
    const user = requireSessionUser(request);
    const body = z
      .object({
        name: z.string().min(1).max(120),
        /** Null or omitted means every project the owner can reach. */
        projectId: z.string().nullable().optional(),
        expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
      })
      .parse(request.body);

    const db = await getDb();

    /*
     * A scope is only meaningful if the owner can actually reach that project,
     * and checking here means a scoped token can never be a way to name a
     * project id and see whether it exists.
     */
    if (body.projectId) {
      const reachable = await db.get<{ id: string }>(
        `SELECT p.id FROM projects p
          WHERE p.id = ?
            AND (p.owner_id = ?
                 OR EXISTS (SELECT 1 FROM project_members m
                             WHERE m.project_id = p.id AND m.user_id = ?))`,
        [body.projectId, user.id, user.id],
      );
      if (!reachable) {
        throw new HttpError(404, "not_found", "Project not found.");
      }
    }

    const created = await createApiToken(db, {
      userId: user.id,
      name: body.name,
      projectId: body.projectId ?? null,
      expiresInDays: body.expiresInDays ?? null,
    });

    // The only response that ever carries the token itself.
    return { id: created.id, token: created.token };
  });

  app.delete("/api/tokens/:id", async (request) => {
    const user = requireSessionUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const db = await getDb();
    if (!(await revokeApiToken(db, user.id, id))) {
      throw new HttpError(404, "not_found", "No such token.");
    }
    return { ok: true };
  });
}
