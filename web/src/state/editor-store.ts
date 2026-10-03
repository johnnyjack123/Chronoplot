/*
 * Editor state: the document being edited, the undo history, and what is
 * selected.
 *
 * The document is the only thing that syncs. Selection, zoom and panel state
 * are deliberately local - they are about *this* browser tab, not about the
 * project, and syncing them would make two people fight over the viewport.
 */
import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { Item, Precision, Row, TimelineDoc } from "@shared";
import {
  addDays, addYears, daysBetween, endOfMonth, endOfYear, snapToPrecision,
  startOfMonth, startOfYear, today,
} from "@/lib/dates";
import { clampZoom } from "@/features/timeline/geometry";

const HISTORY_LIMIT = 100;
/** Upper bound on how long a timeline may span. See `updateSettings`. */
const MAX_SPAN_YEARS = 2000;
/** Two edits sharing a coalesce key merge into one undo step within this window. */
const COALESCE_WINDOW_MS = 900;

interface HistoryEntry {
  doc: TimelineDoc;
  /** Identifies a run of related edits, e.g. one continuous drag. */
  coalesceKey?: string;
  at: number;
}

/**
 * The precision a document is mostly built in, used to seed `lastPrecision`.
 *
 * The commonest one rather than the newest: a year-based timeline with one
 * day-precision milestone in it is still a year-based timeline, and opening it
 * should not hand back days because of that single card.
 */
function dominantPrecision(doc: TimelineDoc): Precision {
  const tally = new Map<Precision, number>();
  for (const item of doc.items) tally.set(item.precision, (tally.get(item.precision) ?? 0) + 1);

  let best: Precision = "day";
  let bestCount = 0;
  for (const [precision, count] of tally) {
    if (count > bestCount) {
      best = precision;
      bestCount = count;
    }
  }
  return best;
}

export type Selection =
  | { kind: "none" }
  | { kind: "item"; id: string }
  | { kind: "row"; id: string }
  | { kind: "group"; id: string };

export interface EditorState {
  projectId: string | null;
  title: string;
  doc: TimelineDoc | null;
  /** Server version this document is based on; drives conflict detection. */
  baseVersion: number;
  role: "owner" | "editor" | "viewer";

  past: HistoryEntry[];
  future: HistoryEntry[];
  /** True when there are edits the server has not acknowledged yet. */
  dirty: boolean;

  selection: Selection;
  /** Horizontal zoom, in pixels per day. */
  unitsPerDay: number;
  /** Width of the plot area on screen, reported by the canvas. Drives "fit". */
  plotWidth: number;
  /** Item id whose link is being dragged, if any. */
  linkingFrom: string | null;

  /**
   * Precision the last edited item used. New cards inherit it, because someone
   * working in years does not want to reset every card back from days.
   */
  lastPrecision: Precision;
  /** Magnetic snapping to other cards' edges while dragging. */
  snapping: boolean;
  /**
   * What is being renamed in place - a card, lane or group. Inline editing is
   * view state, so it lives here rather than in the document.
   */
  editingId: string | null;
  /**
   * A requested change of view, for the canvas to animate.
   *
   * The canvas owns the scroll container, so only it can move the viewport -
   * and "fit" is as much a scroll as a zoom, which is why simply setting the
   * zoom left the old scroll position behind and cut off the left-hand side.
   * The sequence number is what makes repeating the same request fire again.
   */
  viewCommand: { seq: number; zoom: number | "fit" } | null;

  load: (input: {
    projectId: string;
    title: string;
    doc: TimelineDoc;
    version: number;
    role: "owner" | "editor" | "viewer";
  }) => void;
  reset: () => void;

  /** Applies an edit and records it in the undo history. */
  mutate: (recipe: (draft: Draft<TimelineDoc>) => void, options?: { coalesceKey?: string }) => void;
  /** Applies an edit that is *not* undoable and does not mark the doc dirty. */
  setTitle: (title: string) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  select: (selection: Selection) => void;
  setZoom: (unitsPerDay: number) => void;
  setPlotWidth: (width: number) => void;
  setLastPrecision: (precision: Precision) => void;
  setSnapping: (snapping: boolean) => void;
  setEditing: (id: string | null) => void;
  /** Asks the canvas to animate to a zoom level, or to fit the whole timeline. */
  requestZoom: (zoom: number | "fit") => void;
  setLinkingFrom: (id: string | null) => void;

  /** Called by the sync engine once the server has stored a version. */
  markSynced: (version: number) => void;
  /** Replaces the document wholesale after a conflict is resolved. */
  adoptServerDocument: (doc: TimelineDoc, version: number, title: string) => void;
}

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  title: "",
  doc: null,
  baseVersion: 1,
  role: "viewer",
  past: [],
  future: [],
  dirty: false,
  selection: { kind: "none" },
  unitsPerDay: 3,
  plotWidth: 1000,
  linkingFrom: null,
  lastPrecision: "day",
  snapping: true,
  editingId: null,
  viewCommand: null,

  load: ({ projectId, title, doc, version, role }) =>
    set({
      projectId,
      title,
      doc,
      baseVersion: version,
      role,
      past: [],
      future: [],
      dirty: false,
      selection: { kind: "none" },
      linkingFrom: null,
      editingId: null,
      // Read back out of the document rather than kept across sessions: a
      // timeline built in years should still hand you years tomorrow, and the
      // project itself already says which it is.
      lastPrecision: dominantPrecision(doc),
    }),

  reset: () =>
    set({
      projectId: null,
      title: "",
      doc: null,
      baseVersion: 1,
      past: [],
      future: [],
      dirty: false,
      selection: { kind: "none" },
      linkingFrom: null,
      editingId: null,
    }),

  mutate: (recipe, options) => {
    const state = get();
    if (!state.doc) return;
    if (state.role === "viewer") return; // Read-only access edits nothing.

    const next = produce(state.doc, recipe);
    if (next === state.doc) return; // The recipe changed nothing.

    const now = Date.now();
    const last = state.past[state.past.length - 1];
    const canCoalesce =
      options?.coalesceKey !== undefined &&
      last?.coalesceKey === options.coalesceKey &&
      now - last.at < COALESCE_WINDOW_MS;

    // When coalescing, the *previous* snapshot stays on the stack - undoing a
    // drag should return to where the card was before the drag began, not to
    // some midpoint of it.
    const past = canCoalesce
      ? [...state.past.slice(0, -1), { ...last, at: now }]
      : [...state.past, { doc: state.doc, coalesceKey: options?.coalesceKey, at: now }];

    set({
      doc: next,
      past: past.slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  },

  setTitle: (title) => set({ title, dirty: true }),

  undo: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous || !state.doc) return;
    set({
      doc: previous.doc,
      past: state.past.slice(0, -1),
      future: [...state.future, { doc: state.doc, at: Date.now() }].slice(-HISTORY_LIMIT),
      dirty: true,
    });
  },

  redo: () => {
    const state = get();
    const next = state.future[state.future.length - 1];
    if (!next || !state.doc) return;
    set({
      doc: next.doc,
      future: state.future.slice(0, -1),
      past: [...state.past, { doc: state.doc, at: Date.now() }].slice(-HISTORY_LIMIT),
      dirty: true,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  select: (selection) => set({ selection }),
  setZoom: (unitsPerDay) => set({ unitsPerDay: clampZoom(unitsPerDay) }),
  setPlotWidth: (plotWidth) => set({ plotWidth }),
  setLastPrecision: (lastPrecision) => set({ lastPrecision }),
  setSnapping: (snapping) => set({ snapping }),
  setEditing: (editingId) => set({ editingId }),
  requestZoom: (zoom) => set({ viewCommand: { seq: (get().viewCommand?.seq ?? 0) + 1, zoom } }),
  setLinkingFrom: (linkingFrom) => set({ linkingFrom }),

  markSynced: (version) => set({ baseVersion: version, dirty: false }),

  adoptServerDocument: (doc, version, title) =>
    set({ doc, baseVersion: version, title, dirty: false, past: [], future: [] }),
}));

/* ------------------------------------------------------------- commands -- */

/*
 * Document edits live here rather than in components, so the same operation is
 * identical whether it was triggered by a menu, a keyboard shortcut or a drag.
 */
export const commands = {
  /*
   * A new lane opens straight into its name field. A lane called "Lane 4" is
   * never what anyone wanted, and making them hunt for where to rename it turns
   * one action into three.
   */
  addRow(title?: string): string {
    const id = newId();
    const store = useEditorStore.getState();
    store.mutate((draft) => {
      draft.rows.push({ id, groupId: null, title: title ?? `Lane ${draft.rows.length + 1}` });
    });
    store.select({ kind: "row", id });
    store.setEditing(id);
    return id;
  },

  addRowToGroup(groupId: string): string {
    const id = newId();
    const store = useEditorStore.getState();
    store.mutate((draft) => {
      const count = draft.rows.filter((row) => row.groupId === groupId).length;
      draft.rows.push({ id, groupId, title: `Lane ${count + 1}` });
    });
    store.select({ kind: "row", id });
    store.setEditing(id);
    return id;
  },

  /*
   * Sub-lanes are a property of the lane, not a side effect of its contents.
   *
   * The packer has always opened a sub-line when cards clashed, but that was
   * derived - move the card away and the sub-line went with it. Keeping a count
   * on the row is what makes an empty one a place you can aim at.
   */
  addSubLane(rowId: string): void {
    useEditorStore.getState().mutate((draft) => {
      const row = draft.rows.find((candidate) => candidate.id === rowId);
      if (!row) return;
      // Count from what is drawn, not from the stored number: a lane the packer
      // already split needs the new sub-lane *below* those, or pressing the
      // button appears to do nothing.
      const used = draft.items
        .filter((item) => item.rowId === rowId)
        .reduce((most, item) => Math.max(most, (item.subLane ?? 0) + 1), 1);
      row.subLanes = Math.min(50, Math.max(row.subLanes ?? 1, used) + 1);
    });
  },

  /**
   * Drops the last sub-lane, and with it the pins of anything standing on it -
   * those cards go back to being arranged rather than being deleted.
   */
  removeSubLane(rowId: string): void {
    useEditorStore.getState().mutate((draft) => {
      const row = draft.rows.find((candidate) => candidate.id === rowId);
      if (!row) return;

      // The effective count, not the stored one: a lane can have sub-lanes
      // purely because cards were pinned to them, with nothing on the row.
      // Reading `subLanes` alone there would make Remove do nothing at all.
      const effective = Math.max(
        row.subLanes ?? 1,
        draft.items
          .filter((item) => item.rowId === rowId)
          .reduce((most, item) => Math.max(most, (item.subLane ?? 0) + 1), 1),
      );
      if (effective <= 1) return;

      const doomed = effective - 1;
      for (const item of draft.items) {
        if (item.rowId === rowId && item.subLane !== undefined && item.subLane >= doomed) {
          delete item.subLane;
        }
      }
      if (doomed <= 1) delete row.subLanes;
      else row.subLanes = doomed;
    });
  },

  /**
   * Pins a card to a sub-lane, or lets it be arranged again when given null.
   *
   * Setting one past what the lane keeps grows the lane, so dropping a card
   * below the last sub-lane creates the one it was dropped on - which is how
   * someone discovers the feature without being told about it.
   */
  setSubLane(itemId: string, subLane: number | null, coalesceKey?: string): void {
    useEditorStore.getState().mutate((draft) => {
      const item = draft.items.find((candidate) => candidate.id === itemId);
      if (!item) return;

      if (subLane === null) {
        delete item.subLane;
        return;
      }

      const index = Math.max(0, Math.min(49, Math.round(subLane)));
      item.subLane = index;

      const row = draft.rows.find((candidate) => candidate.id === item.rowId);
      if (row && index + 1 > (row.subLanes ?? 1)) row.subLanes = index + 1;
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  renameRow(rowId: string, title: string): void {
    useEditorStore.getState().mutate((draft) => {
      const row = draft.rows.find((candidate) => candidate.id === rowId);
      if (row) row.title = title;
    }, { coalesceKey: `rename-row:${rowId}` });
  },

  removeRow(rowId: string): void {
    useEditorStore.getState().mutate((draft) => {
      const doomed = new Set(draft.items.filter((item) => item.rowId === rowId).map((i) => i.id));
      draft.rows = draft.rows.filter((row) => row.id !== rowId);
      draft.items = draft.items.filter((item) => item.rowId !== rowId);
      // Links pointing at a deleted item would dangle, and the server rejects
      // dangling references, so clean them up in the same step.
      draft.links = draft.links.filter((link) => !doomed.has(link.fromId) && !doomed.has(link.toId));
    });
  },

  /**
   * Moves a lane to a new place in the visual order, possibly into or out of a
   * group, in one step.
   *
   * The rendered order is "ungrouped rows first, then each group's rows", both
   * in array order - so a plain array index is not the same thing as a position
   * on screen. Rather than trying to compute the right index, this rebuilds the
   * array in the order the screen shows, which is unambiguous and makes the
   * same-group case fall out for free.
   *
   * `beforeRowId` is the lane to land in front of, or null to go last in the
   * target group.
   */
  reorderRow(rowId: string, targetGroupId: string | null, beforeRowId: string | null): void {
    if (rowId === beforeRowId) return;

    useEditorStore.getState().mutate((draft) => {
      const moving = draft.rows.find((row) => row.id === rowId);
      if (!moving) return;
      if (targetGroupId !== null && !draft.groups.some((group) => group.id === targetGroupId)) return;

      const rest = draft.rows.filter((row) => row.id !== rowId);
      moving.groupId = targetGroupId;

      const inTarget = rest.filter((row) => row.groupId === targetGroupId);
      const at = beforeRowId === null ? inTarget.length : inTarget.findIndex((row) => row.id === beforeRowId);
      inTarget.splice(at === -1 ? inTarget.length : at, 0, moving);

      // Reassemble in render order so the array and the screen always agree.
      const ordered = [
        ...(targetGroupId === null ? inTarget : rest.filter((row) => row.groupId === null)),
      ];
      for (const group of draft.groups) {
        ordered.push(...(group.id === targetGroupId ? inTarget : rest.filter((row) => row.groupId === group.id)));
      }
      draft.rows = ordered;
    });
  },

  /** Moves a group before another, or to the end when `beforeGroupId` is null. */
  reorderGroup(groupId: string, beforeGroupId: string | null): void {
    if (groupId === beforeGroupId) return;

    useEditorStore.getState().mutate((draft) => {
      const moving = draft.groups.find((group) => group.id === groupId);
      if (!moving) return;

      const rest = draft.groups.filter((group) => group.id !== groupId);
      const at = beforeGroupId === null ? rest.length : rest.findIndex((group) => group.id === beforeGroupId);
      rest.splice(at === -1 ? rest.length : at, 0, moving);
      draft.groups = rest;
    });
  },

  /** Tints a whole lane. `undefined` clears it back to no colour. */
  setRowColor(rowId: string, color: number | undefined): void {
    useEditorStore.getState().mutate((draft) => {
      const row = draft.rows.find((candidate) => candidate.id === rowId);
      if (!row) return;
      if (color === undefined) delete row.color;
      else row.color = color;
    });
  },

  setRowGroup(rowId: string, groupId: string | null): void {
    useEditorStore.getState().mutate((draft) => {
      const row = draft.rows.find((candidate) => candidate.id === rowId);
      if (row) row.groupId = groupId;
    });
  },

  addGroup(title?: string): string {
    const id = newId();
    const store = useEditorStore.getState();
    store.mutate((draft) => {
      draft.groups.push({ id, title: title ?? `Phase ${draft.groups.length + 1}`, collapsed: false });
    });
    store.select({ kind: "group", id });
    store.setEditing(id);
    return id;
  },

  renameGroup(groupId: string, title: string): void {
    useEditorStore.getState().mutate((draft) => {
      const group = draft.groups.find((candidate) => candidate.id === groupId);
      if (group) group.title = title;
    }, { coalesceKey: `rename-group:${groupId}` });
  },

  toggleGroup(groupId: string): void {
    useEditorStore.getState().mutate((draft) => {
      const group = draft.groups.find((candidate) => candidate.id === groupId);
      if (group) group.collapsed = !group.collapsed;
    });
  },

  removeGroup(groupId: string): void {
    useEditorStore.getState().mutate((draft) => {
      // Rows survive their group; they move back to the top level rather than
      // being deleted with it, because losing work to a mis-click is worse than
      // an extra tidy-up step.
      for (const row of draft.rows) {
        if (row.groupId === groupId) row.groupId = null;
      }
      draft.groups = draft.groups.filter((group) => group.id !== groupId);
    });
  },

  addItem(input: Partial<Item> & { rowId: string; start: string; end: string }): string {
    const id = newId();
    const store = useEditorStore.getState();
    // Inherit the precision last worked in, and snap the dates to it, so a card
    // drawn while working in months covers whole months from the start.
    const precision = input.precision ?? store.lastPrecision;

    store.mutate((draft) => {
      const used = draft.items.length;
      const kind = input.kind ?? "bar";
      const start = snapToPrecision(input.start, precision, "start");
      draft.items.push({
        id,
        rowId: input.rowId,
        kind,
        title: input.title ?? "Untitled",
        // Cycling through the eight slots by creation order means a fresh
        // timeline is varied without the user having to pick colours.
        color: input.color ?? ((used % 8) + 1),
        start,
        end: kind === "milestone" ? start : snapToPrecision(input.end, precision, "end"),
        precision,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.progress !== undefined ? { progress: input.progress } : {}),
      });
    });
    return id;
  },

  updateItem(itemId: string, patch: Partial<Item>, coalesceKey?: string): void {
    if (patch.precision) useEditorStore.getState().setLastPrecision(patch.precision);

    useEditorStore.getState().mutate((draft) => {
      const item = draft.items.find((candidate) => candidate.id === itemId);
      if (!item) return;
      Object.assign(item, patch);
      // A milestone is a single day by definition; enforcing it here means no
      // caller can produce a document the server would reject.
      if (item.kind === "milestone") item.end = item.start;
      if (item.end < item.start) item.end = item.start;
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  /** Places a copy of the same length immediately after the original. */
  duplicateItem(itemId: string): string | null {
    const state = useEditorStore.getState();
    const source = state.doc?.items.find((item) => item.id === itemId);
    if (!source) return null;

    const id = newId();
    const span = daysBetween(source.start, source.end);
    const start = addDays(source.end, 1);

    state.mutate((draft) => {
      draft.items.push({ ...source, id, title: `${source.title} copy`, start, end: addDays(start, span) });
    });
    return id;
  },

  removeItem(itemId: string): void {
    useEditorStore.getState().mutate((draft) => {
      draft.items = draft.items.filter((item) => item.id !== itemId);
      draft.links = draft.links.filter((link) => link.fromId !== itemId && link.toId !== itemId);
    });
  },

  linkItems(fromId: string, toId: string): void {
    if (fromId === toId) return;
    useEditorStore.getState().mutate((draft) => {
      const exists = draft.links.some(
        (link) =>
          (link.fromId === fromId && link.toId === toId) ||
          (link.fromId === toId && link.toId === fromId),
      );
      if (!exists) draft.links.push({ id: newId(), fromId, toId });
    });
  },

  unlink(linkId: string): void {
    useEditorStore.getState().mutate((draft) => {
      draft.links = draft.links.filter((link) => link.id !== linkId);
    });
  },

  updateSettings(patch: Partial<TimelineDoc["settings"]>): void {
    useEditorStore.getState().mutate((draft) => {
      Object.assign(draft.settings, patch);
      if (draft.settings.end < draft.settings.start) {
        draft.settings.end = draft.settings.start;
      }
      // A safety net, not a product limit: two millennia is far beyond any real
      // plan, and it stops a mistyped year from producing a document whose
      // span makes every later calculation meaningless.
      const ceiling = addYears(draft.settings.start, MAX_SPAN_YEARS);
      if (draft.settings.end > ceiling) draft.settings.end = ceiling;
      // Items outside the new window would be invisible and unreachable, so
      // pull them back inside rather than silently losing them.
      for (const item of draft.items) {
        if (item.start < draft.settings.start) item.start = draft.settings.start;
        if (item.end > draft.settings.end) item.end = draft.settings.end;
        if (item.end < item.start) item.end = item.start;
      }
    });
  },

  /** Extends the window to whole months or years around the current range. */
  fitWindowToItems(): void {
    useEditorStore.getState().mutate((draft) => {
      if (draft.items.length === 0) return;
      let min = draft.items[0]!.start;
      let max = draft.items[0]!.end;
      for (const item of draft.items) {
        if (item.start < min) min = item.start;
        if (item.end > max) max = item.end;
      }
      const wide = draft.settings.granularity === "year" || draft.settings.granularity === "quarter";
      draft.settings.start = wide ? startOfYear(min) : startOfMonth(min);
      draft.settings.end = wide ? endOfYear(max) : endOfMonth(max);
    });
  },
};

/** A sensible new row plus a first card, used by the empty-state button. */
export function seedExample(): void {
  const state = useEditorStore.getState();
  if (!state.doc) return;
  const start = state.doc.settings.start;
  const rowId = state.doc.rows[0]?.id ?? commands.addRow("Lane 1");
  commands.addItem({
    rowId,
    title: "First milestone",
    kind: "milestone",
    start: addDays(start, 30),
    end: addDays(start, 30),
    precision: "day",
  });
}

export { newId, today };
export type { Row };
