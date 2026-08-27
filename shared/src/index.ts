/*
 * The timeline document model - the single definition shared by the browser
 * editor and the server.
 *
 * The server never interprets a document beyond validating its shape: all
 * layout maths happens in the browser so editing stays responsive, and the
 * document is synced back as a whole. That is why everything here is plain
 * serialisable data with no derived values - anything derivable is computed by
 * the geometry module at render time instead of being stored and going stale.
 */
import { z } from "zod";

/** Current document schema version, bumped when a migration is needed. */
export const DOC_SCHEMA_VERSION = 1;

/** How precisely a single item's dates are interpreted and edited. */
export const precisionSchema = z.enum(["day", "month", "year"]);
export type Precision = z.infer<typeof precisionSchema>;

/** The unit the time axis ticks in. */
export const granularitySchema = z.enum(["day", "week", "month", "quarter", "year"]);
export type Granularity = z.infer<typeof granularitySchema>;

export const themeNameSchema = z.enum(["midnight", "eclipse", "abyss", "daylight", "parchment"]);
export type ThemeName = z.infer<typeof themeNameSchema>;

/** Calendar date, no time component and no timezone - "YYYY-MM-DD". */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real calendar date");

const idSchema = z.string().min(1).max(64);

export const settingsSchema = z.object({
  /** Inclusive first day shown on the axis. */
  start: isoDateSchema,
  /** Inclusive last day shown on the axis. */
  end: isoDateSchema,
  granularity: granularitySchema,
  theme: themeNameSchema,
  showToday: z.boolean(),
  /** Shades Saturdays and Sundays. Only meaningful at day granularity. */
  showWeekends: z.boolean(),
  /** Draws the dependency arrows between linked items. */
  showLinks: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const groupSchema = z.object({
  id: idSchema,
  title: z.string().max(200),
  collapsed: z.boolean(),
});
export type Group = z.infer<typeof groupSchema>;

export const rowSchema = z.object({
  id: idSchema,
  /** null means the row sits at the top level, outside any group. */
  groupId: idSchema.nullable(),
  title: z.string().max(200),
});
export type Row = z.infer<typeof rowSchema>;

export const itemKindSchema = z.enum(["bar", "milestone"]);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemSchema = z.object({
  id: idSchema,
  rowId: idSchema,
  kind: itemKindSchema,
  title: z.string().max(500),
  notes: z.string().max(5000).optional(),
  /** Palette slot 1-8, or 0 for the neutral slate. See docs/DESIGN.md section 6. */
  color: z.number().int().min(0).max(8),
  start: isoDateSchema,
  /** Inclusive end. Equal to `start` for a milestone. */
  end: isoDateSchema,
  precision: precisionSchema,
  /** Optional completion, drawn as a darker inset fill. */
  progress: z.number().min(0).max(1).optional(),
});
export type Item = z.infer<typeof itemSchema>;

export const linkSchema = z.object({
  id: idSchema,
  fromId: idSchema,
  toId: idSchema,
});
export type Link = z.infer<typeof linkSchema>;

export const timelineDocSchema = z.object({
  schemaVersion: z.literal(DOC_SCHEMA_VERSION),
  settings: settingsSchema,
  /** Order is meaningful: groups render top to bottom in array order. */
  groups: z.array(groupSchema).max(200),
  /** Order is meaningful within a group. */
  rows: z.array(rowSchema).max(1000),
  items: z.array(itemSchema).max(5000),
  links: z.array(linkSchema).max(5000),
});
export type TimelineDoc = z.infer<typeof timelineDocSchema>;

/*
 * Referential integrity. The shape check above cannot see that an item points
 * at a row that exists, so this runs as a second pass - on the server before a
 * document is stored, and in the browser before it is sent.
 */
export function findDocumentInconsistencies(doc: TimelineDoc): string[] {
  const problems: string[] = [];
  const groupIds = new Set(doc.groups.map((g) => g.id));
  const rowIds = new Set(doc.rows.map((r) => r.id));
  const itemIds = new Set(doc.items.map((i) => i.id));

  if (groupIds.size !== doc.groups.length) problems.push("Duplicate group id");
  if (rowIds.size !== doc.rows.length) problems.push("Duplicate row id");
  if (itemIds.size !== doc.items.length) problems.push("Duplicate item id");

  for (const row of doc.rows) {
    if (row.groupId !== null && !groupIds.has(row.groupId)) {
      problems.push(`Row ${row.id} references missing group ${row.groupId}`);
    }
  }
  for (const item of doc.items) {
    if (!rowIds.has(item.rowId)) {
      problems.push(`Item ${item.id} references missing row ${item.rowId}`);
    }
    if (item.end < item.start) {
      problems.push(`Item ${item.id} ends before it starts`);
    }
    if (item.kind === "milestone" && item.end !== item.start) {
      problems.push(`Milestone ${item.id} must start and end on the same day`);
    }
  }
  for (const link of doc.links) {
    if (!itemIds.has(link.fromId) || !itemIds.has(link.toId)) {
      problems.push(`Link ${link.id} references a missing item`);
    }
    if (link.fromId === link.toId) {
      problems.push(`Link ${link.id} points at itself`);
    }
  }
  if (doc.settings.end < doc.settings.start) {
    problems.push("Timeline ends before it starts");
  }
  return problems;
}

/** Parses and integrity-checks in one step. Throws on the first problem. */
export function parseDocument(value: unknown): TimelineDoc {
  const doc = timelineDocSchema.parse(value);
  const problems = findDocumentInconsistencies(doc);
  if (problems.length > 0) {
    throw new Error(`Inconsistent timeline document: ${problems.join("; ")}`);
  }
  return doc;
}

/* -------------------------------------------------------- API contracts -- */

export const projectSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
  ownerName: z.string(),
  version: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Small numbers shown on the dashboard card without loading the document. */
  itemCount: z.number().int(),
  rowCount: z.number().int(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectDetailSchema = projectSummarySchema.extend({
  doc: timelineDocSchema,
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const saveProjectRequestSchema = z.object({
  title: z.string().min(1).max(200),
  doc: timelineDocSchema,
  /** The version the editor last saw. A mismatch means someone else saved first. */
  baseVersion: z.number().int().min(1),
});
export type SaveProjectRequest = z.infer<typeof saveProjectRequestSchema>;

export const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const registerSchema = credentialsSchema.extend({
  name: z.string().min(1).max(120),
});
