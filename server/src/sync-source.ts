import { randomUUID } from "node:crypto";
import type { Item, Row, SyncItem, SyncRequest, SyncResult, TimelineDoc } from "./shared.js";
import { snapToUnit } from "./shared.js";

/*
 * Reconciling a document with what an external source says it should contain.
 *
 * Pure: takes a document and a payload, returns a new document and a summary.
 * That is what makes a dry run free - the caller simply does not save the
 * result - and what makes this testable without a server or a database.
 *
 * The rule throughout: items carrying this source are owned by the source, and
 * items without one are never touched. Everything else follows from that.
 */

const sameSource = (item: Item, source: SyncRequest["source"]): boolean =>
  item.source?.kind === source.kind && item.source.vault === source.vault;

/** Fields the source dictates. Anything else is left as the project has it. */
function applySourceFields(target: Item, incoming: SyncItem, vault: string): void {
  const kind = incoming.kind ?? (incoming.end === undefined ? "milestone" : "bar");
  const start = snapToUnit(incoming.start, incoming.precision, "start");

  target.title = incoming.title;
  target.kind = kind;
  target.precision = incoming.precision;
  target.start = start;
  target.end =
    kind === "milestone"
      ? start
      : snapToUnit(incoming.end ?? incoming.start, incoming.precision, "end");

  if (target.end < target.start) {
    target.end = target.start;
  }

  // Optional fields are only written when the source states them, so a colour
  // or a note added in Chronoplot survives the next sync.
  if (incoming.color !== undefined) {
    target.color = incoming.color;
  }
  if (incoming.notes !== undefined) {
    target.notes = incoming.notes;
  }
  if (incoming.progress !== undefined) {
    target.progress = incoming.progress;
  }

  target.source = {
    kind: "obsidian",
    vault,
    path: incoming.path,
    ...(incoming.url ? { url: incoming.url } : {}),
  };
}

export function reconcile(
  doc: TimelineDoc,
  request: SyncRequest,
): { doc: TimelineDoc; result: Omit<SyncResult, "version"> } {
  const next: TimelineDoc = structuredClone(doc);
  const warnings: string[] = [];
  const lanesCreated: string[] = [];

  /* Duplicate paths would fight each other on every sync, so settle it here. */
  const seen = new Set<string>();
  const incoming: SyncItem[] = [];
  for (const item of request.items) {
    if (seen.has(item.path)) {
      warnings.push(`${item.path}: listed more than once, later entries ignored`);
      continue;
    }
    seen.add(item.path);
    incoming.push(item);
  }

  /* ------------------------------------------------------------- lanes -- */

  const laneByName = new Map<string, Row>();
  for (const row of next.rows) {
    laneByName.set(row.title.trim().toLowerCase(), row);
  }

  const laneFor = (name: string | undefined): string => {
    // Everything has to land somewhere. A source that names no lane gets one
    // named after the vault, which is more use than a lane called "Lane 1".
    const wanted = (name ?? request.source.vault).trim();
    const key = wanted.toLowerCase();

    const existing = laneByName.get(key);
    if (existing) {
      return existing.id;
    }

    const row: Row = { id: randomUUID(), groupId: null, title: wanted };
    next.rows.push(row);
    laneByName.set(key, row);
    lanesCreated.push(wanted);
    return row.id;
  };

  /* ------------------------------------------------------------- items -- */

  const owned = new Map<string, Item>();
  for (const item of next.items) {
    if (sameSource(item, request.source) && item.source) {
      owned.set(item.source.path, item);
    }
  }

  let created = 0;
  let updated = 0;

  for (const entry of incoming) {
    // Dates outside the window would be invisible and unreachable, so widen the
    // window rather than silently clamping a note's dates to something it does
    // not say.
    if (entry.start < next.settings.start) {
      next.settings.start = entry.start;
    }
    const latest = entry.end ?? entry.start;
    if (latest > next.settings.end) {
      next.settings.end = latest;
    }

    const existing = owned.get(entry.path);
    if (existing) {
      applySourceFields(existing, entry, request.source.vault);
      // A lane named by the source moves the card; one it leaves out does not.
      if (entry.lane !== undefined) {
        existing.rowId = laneFor(entry.lane);
      }
      updated++;
      continue;
    }

    const item: Item = {
      id: randomUUID(),
      rowId: laneFor(entry.lane),
      kind: "bar",
      title: entry.title,
      color: (next.items.length % 8) + 1,
      start: entry.start,
      end: entry.end ?? entry.start,
      precision: entry.precision,
    };
    applySourceFields(item, entry, request.source.vault);
    next.items.push(item);
    created++;
  }

  /* ----------------------------------------------------------- removals -- */

  const gone = [...owned.entries()].filter(([path]) => !seen.has(path));
  const doomed = new Set(gone.map(([, item]) => item.id));

  if (doomed.size > 0) {
    next.items = next.items.filter((item) => !doomed.has(item.id));
    // Links to a removed item would dangle, and the document check rejects
    // that, so they go with it.
    next.links = next.links.filter(
      (link) => !doomed.has(link.fromId) && !doomed.has(link.toId),
    );
  }

  /*
   * Lanes are never removed. Emptying one by deleting the last note leaves an
   * empty lane, which is far less alarming than a lane disappearing - and it
   * may well hold cards somebody added by hand later.
   */

  return {
    doc: next,
    result: {
      created,
      updated,
      removed: doomed.size,
      lanesCreated,
      warnings,
      dryRun: request.dryRun === true,
    },
  };
}
