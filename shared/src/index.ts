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

/**
 * Days in a month, in UTC so it never depends on the reader's timezone.
 */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Snaps a date to the boundary of the unit its precision names.
 *
 * This is document semantics, not presentation, which is why it lives here
 * rather than in the editor: a month-precision item *means* the whole month, so
 * a start of "2026-03-17" at month precision is 1 March and its end is 31
 * March. The editor and the sync endpoint both have to agree on that, and the
 * only way to guarantee it is one implementation.
 */
export function snapToUnit(
  date: string,
  precision: Precision,
  edge: "start" | "end",
): string {
  if (precision === "day") {
    return date;
  }
  if (precision === "year") {
    return edge === "start" ? `${date.slice(0, 4)}-01-01` : `${date.slice(0, 4)}-12-31`;
  }

  if (edge === "start") {
    return `${date.slice(0, 7)}-01`;
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  return `${date.slice(0, 7)}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
}

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
  /**
   * Optional palette slot tinting the whole lane. Optional rather than
   * defaulted so documents written before lanes could be coloured stay valid.
   */
  color: z.number().int().min(0).max(8).optional(),
  /**
   * How many sub-lanes this lane keeps, whether or not anything sits on them.
   *
   * The packer has always opened a sub-line when two cards overlapped, but that
   * was derived: remove the card and the sub-line vanished. This is the lane's
   * own shape - a deliberately empty row you can drop a card onto. Absent means
   * "however many the packer needs", which is what every existing document
   * means.
   */
  subLanes: z.number().int().min(1).max(50).optional(),
});
export type Row = z.infer<typeof rowSchema>;

export const itemKindSchema = z.enum(["bar", "milestone"]);
export type ItemKind = z.infer<typeof itemKindSchema>;

/**
 * Where an item came from, when it was not drawn by hand.
 *
 * This is what lets a sync replace its own cards without touching anything a
 * person made. Without it a sync would have to either wipe the project or
 * guess which cards were once its own.
 */
export const itemSourceSchema = z.object({
  kind: z.literal("obsidian"),
  /** Names the vault, so two vaults can feed one project without collision. */
  vault: z.string().min(1).max(200),
  /** Vault-relative path. Together with kind+vault this identifies the item. */
  path: z.string().min(1).max(1000),
  /**
   * Link back to the note.
   *
   * Restricted to two schemes on purpose: this value is user-controlled and
   * ends up in an href in the editor and in every HTML export, so a
   * `javascript:` URL here would be stored cross-site scripting.
   */
  url: z
    .string()
    .max(2000)
    .refine((value) => /^(obsidian|https):\/\//i.test(value), {
      message: "Only obsidian:// and https:// links are allowed",
    })
    .optional(),
});
export type ItemSource = z.infer<typeof itemSourceSchema>;

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
  /**
   * Which sub-lane of its lane this card sits on, 0-based.
   *
   * Absent means "wherever it fits", which is how every card behaved before and
   * how a freshly drawn one still behaves. Setting it pins the card: the packer
   * puts it exactly there and arranges the unpinned ones around it. That is the
   * whole difference between a sub-line that appears because two dates clashed
   * and a sub-lane you decided on.
   */
  subLane: z.number().int().min(0).max(49).optional(),
  /** Set only on items maintained by an external source. See above. */
  source: itemSourceSchema.optional(),
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

  if (groupIds.size !== doc.groups.length) {
    problems.push("Duplicate group id");
  }
  if (rowIds.size !== doc.rows.length) {
    problems.push("Duplicate row id");
  }
  if (itemIds.size !== doc.items.length) {
    problems.push("Duplicate item id");
  }

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

/* ------------------------------------------------------ external sync -- */

/**
 * One item as an external source describes it.
 *
 * Not the same shape as an `Item`: there is no id (the path identifies it) and
 * the lane is a *name* rather than a row id, because the source has no idea
 * what rows exist. Fields left out are preserved from whatever the project
 * already has, so a colour chosen in Chronoplot survives a re-sync.
 */
export const syncItemSchema = z.object({
  path: z.string().min(1).max(1000),
  title: z.string().min(1).max(500),
  start: isoDateSchema,
  /** Omitted for a milestone. */
  end: isoDateSchema.optional(),
  precision: precisionSchema,
  kind: itemKindSchema.optional(),
  /** Lane name. Created if no lane by that name exists. */
  lane: z.string().min(1).max(200).optional(),
  color: z.number().int().min(0).max(8).optional(),
  notes: z.string().max(5000).optional(),
  progress: z.number().min(0).max(1).optional(),
  url: itemSourceSchema.shape.url,
});
export type SyncItem = z.infer<typeof syncItemSchema>;

export const syncRequestSchema = z.object({
  source: z.object({
    kind: z.literal("obsidian"),
    vault: z.string().min(1).max(200),
  }),
  /** Reports what would change without changing anything. */
  dryRun: z.boolean().optional(),
  items: z.array(syncItemSchema).max(2000),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export interface SyncResult {
  created: number;
  updated: number;
  removed: number;
  lanesCreated: string[];
  warnings: string[];
  version: number;
  dryRun: boolean;
}

export const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const registerSchema = credentialsSchema.extend({
  name: z.string().min(1).max(120),
});
