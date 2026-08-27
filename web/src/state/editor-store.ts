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
import type { Item, Row, TimelineDoc } from "@shared";
import { addDays, addYears, daysBetween, endOfMonth, endOfYear, startOfMonth, startOfYear, today } from "@/lib/dates";
import { clampZoom, fitUnitsPerDay } from "@/features/timeline/geometry";

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
  /** Scales so the whole timeline fits the plot area. */
  zoomToFit: () => void;
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

  zoomToFit: () => {
    const { doc, plotWidth } = get();
    if (doc) set({ unitsPerDay: fitUnitsPerDay(doc, plotWidth) });
  },
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
  addRow(title?: string): string {
    const id = newId();
    useEditorStore.getState().mutate((draft) => {
      draft.rows.push({ id, groupId: null, title: title ?? `Lane ${draft.rows.length + 1}` });
    });
    return id;
  },

  addRowToGroup(groupId: string): string {
    const id = newId();
    useEditorStore.getState().mutate((draft) => {
      const count = draft.rows.filter((row) => row.groupId === groupId).length;
      draft.rows.push({ id, groupId, title: `Lane ${count + 1}` });
    });
    return id;
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

  moveRow(rowId: string, toIndex: number): void {
    useEditorStore.getState().mutate((draft) => {
      const from = draft.rows.findIndex((row) => row.id === rowId);
      if (from === -1) return;
      const [row] = draft.rows.splice(from, 1);
      if (row) draft.rows.splice(Math.max(0, Math.min(draft.rows.length, toIndex)), 0, row);
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
    useEditorStore.getState().mutate((draft) => {
      draft.groups.push({ id, title: title ?? `Phase ${draft.groups.length + 1}`, collapsed: false });
    });
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
    useEditorStore.getState().mutate((draft) => {
      const used = draft.items.length;
      draft.items.push({
        id,
        rowId: input.rowId,
        kind: input.kind ?? "bar",
        title: input.title ?? "Untitled",
        // Cycling through the eight slots by creation order means a fresh
        // timeline is varied without the user having to pick colours.
        color: input.color ?? ((used % 8) + 1),
        start: input.start,
        end: input.end,
        precision: input.precision ?? "day",
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.progress !== undefined ? { progress: input.progress } : {}),
      });
    });
    return id;
  },

  updateItem(itemId: string, patch: Partial<Item>, coalesceKey?: string): void {
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
