import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, type Db } from "../db/index.js";
import type { MemberRole, ProjectRow } from "../db/schema.js";
import { HttpError } from "../http-error.js";
import { requireUser } from "../auth/plugin.js";
import {
  findDocumentInconsistencies,
  saveProjectRequestSchema,
  timelineDocSchema,
  type TimelineDoc,
} from "../shared.js";

/*
 * Authorisation model: a project has one owner plus rows in project_members.
 * Every handler resolves the caller's role through `loadAccess` first - there
 * is deliberately no code path that reads or writes a project without going
 * through it.
 */
interface Access {
  project: ProjectRow;
  role: MemberRole;
}

async function loadAccess(db: Db, projectId: string, userId: string): Promise<Access> {
  const project = await db.get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [projectId]);
  // A project the caller may not see is reported as missing, not as forbidden,
  // so ids cannot be probed for existence.
  if (!project) throw new HttpError(404, "not_found", "Project not found.");

  if (project.owner_id === userId) return { project, role: "owner" };

  const member = await db.get<{ role: MemberRole }>(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`,
    [projectId, userId],
  );
  if (!member) throw new HttpError(404, "not_found", "Project not found.");

  return { project, role: member.role };
}

function assertCanEdit(access: Access): void {
  if (access.role === "viewer") {
    throw new HttpError(403, "read_only", "You have read-only access to this project.");
  }
}

function assertOwner(access: Access): void {
  if (access.role !== "owner") {
    throw new HttpError(403, "owner_only", "Only the project owner can do that.");
  }
}

function parseStoredDoc(project: ProjectRow): TimelineDoc {
  // Stored documents were validated on the way in; a parse failure here means
  // the row was written by an older schema version or edited by hand.
  return timelineDocSchema.parse(JSON.parse(project.doc));
}

async function summaryOf(db: Db, project: ProjectRow, role: MemberRole) {
  const owner = await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, [
    project.owner_id,
  ]);
  const doc = parseStoredDoc(project);
  return {
    id: project.id,
    title: project.title,
    role,
    ownerName: owner?.name ?? "Unknown",
    version: Number(project.version),
    createdAt: Number(project.created_at),
    updatedAt: Number(project.updated_at),
    itemCount: doc.items.length,
    rowCount: doc.rows.length,
  };
}

/** A new project: one empty lane and a one-year window around today. */
function blankDocument(): TimelineDoc {
  const today = new Date();
  const year = today.getUTCFullYear();
  return {
    schemaVersion: 1,
    settings: {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      granularity: "month",
      theme: "midnight",
      showToday: true,
      showWeekends: false,
      showLinks: true,
    },
    groups: [],
    rows: [{ id: randomUUID(), groupId: null, title: "Lane 1" }],
    items: [],
    links: [],
  };
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------- list -- */
  app.get("/api/projects", async (request) => {
    const user = requireUser(request);
    const db = await getDb();

    const rows = await db.all<ProjectRow & { role?: MemberRole }>(
      `SELECT p.*, 'owner' AS role FROM projects p WHERE p.owner_id = ?
       UNION ALL
       SELECT p.*, m.role AS role FROM projects p
         JOIN project_members m ON m.project_id = p.id
        WHERE m.user_id = ? AND p.owner_id <> ?
       ORDER BY updated_at DESC`,
      [user.id, user.id, user.id],
    );

    return {
      projects: await Promise.all(rows.map((row) => summaryOf(db, row, row.role ?? "viewer"))),
    };
  });

  /* ----------------------------------------------------------- create -- */
  app.post("/api/projects", async (request) => {
    const user = requireUser(request);
    const body = z.object({ title: z.string().min(1).max(200) }).parse(request.body);

    const db = await getDb();
    const id = randomUUID();
    const now = Date.now();

    await db.run(
      `INSERT INTO projects (id, owner_id, title, doc, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, user.id, body.title.trim(), JSON.stringify(blankDocument()), 1, now, now],
    );

    const project = await db.get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [id]);
    return { project: await summaryOf(db, project!, "owner") };
  });

  /* ------------------------------------------------------------ import -- */
  /*
   * One step rather than "create then save": importing through the ordinary
   * create-and-update pair would leave an empty project behind whenever the
   * second call failed.
   */
  app.post("/api/projects/import", async (request) => {
    const user = requireUser(request);
    const body = z
      .object({ title: z.string().min(1).max(200), doc: timelineDocSchema })
      .parse(request.body);

    const problems = findDocumentInconsistencies(body.doc);
    if (problems.length > 0) {
      throw new HttpError(422, "inconsistent_document", "The imported timeline is inconsistent.", problems);
    }

    const db = await getDb();
    const id = randomUUID();
    const now = Date.now();

    await db.run(
      `INSERT INTO projects (id, owner_id, title, doc, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, user.id, body.title.trim(), JSON.stringify(body.doc), 1, now, now],
    );

    const project = await db.get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [id]);
    return { project: await summaryOf(db, project!, "owner") };
  });

  /* -------------------------------------------------------------- read -- */
  app.get("/api/projects/:id", async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const db = await getDb();
    const access = await loadAccess(db, id, user.id);

    return {
      project: {
        ...(await summaryOf(db, access.project, access.role)),
        doc: parseStoredDoc(access.project),
      },
    };
  });

  /* -------------------------------------------------------------- save -- */
  app.put("/api/projects/:id", async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = saveProjectRequestSchema.parse(request.body);

    const problems = findDocumentInconsistencies(body.doc);
    if (problems.length > 0) {
      throw new HttpError(422, "inconsistent_document", "The timeline is inconsistent.", problems);
    }

    const db = await getDb();
    const access = await loadAccess(db, id, user.id);
    assertCanEdit(access);

    const currentVersion = Number(access.project.version);
    if (body.baseVersion !== currentVersion) {
      // Someone else saved since this editor last loaded. Hand back the current
      // state so the browser can tell the user rather than silently overwrite.
      throw new HttpError(409, "version_conflict", "This project changed elsewhere.", {
        currentVersion,
        title: access.project.title,
        doc: parseStoredDoc(access.project),
      });
    }

    const nextVersion = currentVersion + 1;
    await db.run(
      `UPDATE projects SET title = ?, doc = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ?`,
      [body.title.trim(), JSON.stringify(body.doc), nextVersion, Date.now(), id, currentVersion],
    );

    // The guarded UPDATE is what actually makes this safe against two writers
    // racing between the check above and the write; confirm it took effect.
    const after = await db.get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [id]);
    if (!after || Number(after.version) !== nextVersion) {
      throw new HttpError(409, "version_conflict", "This project changed elsewhere.", {
        currentVersion: after ? Number(after.version) : currentVersion,
        title: after?.title ?? access.project.title,
        doc: parseStoredDoc(after ?? access.project),
      });
    }

    return { version: nextVersion, updatedAt: Number(after.updated_at) };
  });

  /* ------------------------------------------------------------ delete -- */
  app.delete("/api/projects/:id", async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const db = await getDb();
    assertOwner(await loadAccess(db, id, user.id));
    await db.run(`DELETE FROM projects WHERE id = ?`, [id]);
    return { ok: true };
  });

  /* ------------------------------------------------------------ shares -- */
  app.get("/api/projects/:id/members", async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const db = await getDb();
    const access = await loadAccess(db, id, user.id);

    const owner = await db.get<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE id = ?`,
      [access.project.owner_id],
    );
    const members = await db.all<{ id: string; name: string; email: string; role: MemberRole }>(
      `SELECT u.id, u.name, u.email, m.role
         FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ?
        ORDER BY u.name`,
      [id],
    );

    return {
      members: [{ ...owner!, role: "owner" as const }, ...members],
      canManage: access.role === "owner",
    };
  });

  app.post("/api/projects/:id/members", async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ email: z.string().email(), role: z.enum(["editor", "viewer"]) })
      .parse(request.body);

    const db = await getDb();
    assertOwner(await loadAccess(db, id, user.id));

    const invitee = await db.get<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [
      body.email.trim().toLowerCase(),
    ]);
    if (!invitee) {
      throw new HttpError(404, "user_not_found", "No account with that address exists yet.");
    }
    if (invitee.id === user.id) {
      throw new HttpError(400, "already_owner", "You already own this project.");
    }

    // Re-inviting an existing member updates their role instead of failing.
    await db.run(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`, [id, invitee.id]);
    await db.run(
      `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      [id, invitee.id, body.role, Date.now()],
    );
    return { ok: true };
  });

  app.delete("/api/projects/:id/members/:userId", async (request) => {
    const user = requireUser(request);
    const { id, userId } = z.object({ id: z.string(), userId: z.string() }).parse(request.params);

    const db = await getDb();
    const access = await loadAccess(db, id, user.id);

    // The owner can remove anyone; anyone else may remove only themselves,
    // which is how a collaborator leaves a shared project.
    if (access.role !== "owner" && userId !== user.id) {
      throw new HttpError(403, "owner_only", "Only the project owner can do that.");
    }

    await db.run(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`, [id, userId]);
    return { ok: true };
  });
}
