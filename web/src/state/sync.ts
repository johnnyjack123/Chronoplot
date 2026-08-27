/*
 * Background sync.
 *
 * Editing never waits on the network: every change lands in the local store
 * immediately, and this engine pushes the document up afterwards. That is the
 * whole reason layout maths runs in the browser.
 *
 * Failure handling is the interesting part. A network error is temporary and
 * retried with backoff. A version conflict is not - it means a person changed
 * the same project elsewhere, so the engine stops and hands the decision to the
 * user rather than picking a winner on their behalf.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { TimelineDoc } from "@shared";
import { ApiError, api } from "@/lib/api";
import { useEditorStore } from "./editor-store";

export type SyncStatus = "idle" | "pending" | "saving" | "saved" | "offline" | "conflict" | "denied";

export interface ConflictPayload {
  currentVersion: number;
  title: string;
  doc: TimelineDoc;
}

interface SyncState {
  status: SyncStatus;
  lastSavedAt: number | null;
  /** Set only when status is "conflict". */
  conflict: ConflictPayload | null;
  /** Human-readable reason, shown next to a failed status. */
  message: string | null;
  set: (patch: Partial<SyncState>) => void;
  clearConflict: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: "idle",
  lastSavedAt: null,
  conflict: null,
  message: null,
  set: (patch) => set(patch),
  clearConflict: () => set({ conflict: null, status: "idle", message: null }),
}));

/** Quiet period after the last keystroke or drag before a save is attempted. */
const DEBOUNCE_MS = 700;
const MAX_BACKOFF_MS = 30_000;

export function useSyncEngine(enabled: boolean): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(1000);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const push = async (options: { keepalive?: boolean } = {}): Promise<void> => {
      const state = useEditorStore.getState();
      const sync = useSyncStore.getState();

      if (inFlight.current || !state.doc || !state.projectId || !state.dirty) return;
      if (state.role === "viewer") return;
      // A conflict is a dead end until the user resolves it; retrying would
      // just produce the same 409 forever.
      if (sync.status === "conflict") return;

      inFlight.current = true;
      const attemptedVersion = state.baseVersion;
      const attemptedDoc = state.doc;
      useSyncStore.getState().set({ status: "saving", message: null });

      try {
        const result = await api.saveProject(
          state.projectId,
          { title: state.title, doc: attemptedDoc, baseVersion: attemptedVersion },
          options,
        );

        // Only clear the dirty flag if nothing changed while the request was in
        // flight; otherwise the newer edits still need saving.
        const after = useEditorStore.getState();
        if (after.doc === attemptedDoc && after.baseVersion === attemptedVersion) {
          after.markSynced(result.version);
          useSyncStore.getState().set({
            status: "saved",
            lastSavedAt: result.updatedAt,
            message: null,
          });
        } else {
          useEditorStore.setState({ baseVersion: result.version });
          useSyncStore.getState().set({ status: "pending", lastSavedAt: result.updatedAt });
        }
        backoff.current = 1000;
      } catch (error) {
        if (error instanceof ApiError && error.isConflict) {
          const details = error.details as ConflictPayload | undefined;
          useSyncStore.getState().set({
            status: "conflict",
            conflict: details ?? null,
            message: "This project was changed somewhere else.",
          });
        } else if (error instanceof ApiError && error.code === "read_only") {
          useSyncStore.getState().set({
            status: "denied",
            message: "You have read-only access, so changes are not saved.",
          });
        } else if (error instanceof ApiError && error.isUnauthenticated) {
          useSyncStore.getState().set({
            status: "offline",
            message: "Your session expired. Sign in again to keep editing.",
          });
        } else {
          const detail = error instanceof ApiError ? error.message : "Cannot reach the server.";
          useSyncStore.getState().set({ status: "offline", message: detail });
          // Retry with backoff; the local document is untouched, so nothing is
          // lost while the server is unreachable.
          backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
          setTimeout(() => void push(), backoff.current);
        }
      } finally {
        inFlight.current = false;
      }
    };

    const schedule = (): void => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void push(), DEBOUNCE_MS);
    };

    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.doc === previous.doc && state.title === previous.title) return;
      if (!state.dirty) return;
      if (useSyncStore.getState().status !== "conflict") {
        useSyncStore.getState().set({ status: "pending" });
      }
      schedule();
    });

    /*
     * A tab being hidden or closed is the most likely moment to lose the last
     * few seconds of edits, so flush immediately instead of waiting out the
     * debounce. `keepalive` lets the request outlive the page.
     */
    const flush = (): void => {
      if (timer.current) clearTimeout(timer.current);
      void push({ keepalive: true });
    };

    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, [enabled]);
}

/** Discards local edits and takes the server's version of the project. */
export function resolveConflictWithServer(): void {
  const { conflict } = useSyncStore.getState();
  if (!conflict) return;
  useEditorStore.getState().adoptServerDocument(conflict.doc, conflict.currentVersion, conflict.title);
  useSyncStore.getState().clearConflict();
}

/**
 * Keeps the local edits and rebases them onto the server's version, so the next
 * save overwrites what the other person stored. Deliberately an explicit choice
 * rather than the default.
 */
export function resolveConflictWithLocal(): void {
  const { conflict } = useSyncStore.getState();
  if (!conflict) return;
  useEditorStore.setState({ baseVersion: conflict.currentVersion, dirty: true });
  useSyncStore.getState().clearConflict();
}
