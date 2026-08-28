import { useEffect } from "react";
import { commands, useEditorStore } from "@/state/editor-store";

/**
 * True when the user is typing, in which case shortcuts must not fire - Delete
 * inside a text field means "delete a character", not "delete the card".
 */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable
  );
}

export function useShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      const store = useEditorStore.getState();
      const mod = event.ctrlKey || event.metaKey;

      // Zoom works while typing too - it changes nothing in the document.
      if (mod && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        store.setZoom(store.unitsPerDay * 1.5);
        return;
      }
      if (mod && event.key === "-") {
        event.preventDefault();
        store.setZoom(store.unitsPerDay / 1.5);
        return;
      }
      if (mod && event.key === "0") {
        event.preventDefault();
        store.zoomToFit();
        return;
      }

      if (isTyping(event.target)) return;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }

      // Ctrl+Y is the Windows convention for redo and costs nothing to support.
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        store.redo();
        return;
      }

      if (store.selection.kind === "item") {
        const itemId = store.selection.id;

        if (mod && event.key.toLowerCase() === "d") {
          event.preventDefault();
          const id = commands.duplicateItem(itemId);
          if (id) store.select({ kind: "item", id });
          return;
        }

        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          commands.removeItem(itemId);
          store.select({ kind: "none" });
          return;
        }

        // Arrow keys nudge the selected card by one day, or by a week with
        // Shift - the keyboard equivalent of dragging it.
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const item = store.doc?.items.find((candidate) => candidate.id === itemId);
          if (!item) return;
          const step = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 7 : 1);
          const shift = (date: string): string => {
            const time = Date.parse(`${date}T00:00:00Z`) + step * 86_400_000;
            return new Date(time).toISOString().slice(0, 10);
          };
          commands.updateItem(
            itemId,
            { start: shift(item.start), end: shift(item.end) },
            `nudge:${itemId}`,
          );
          return;
        }
      }

      /*
       * Alt + arrow reorders the selected lane or group. Dragging is the
       * obvious way to do this, but it is also the only way unless something
       * like this exists - and reordering is not an operation that should
       * require a pointer.
       */
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const doc = store.doc;
        if (!doc) return;
        const direction = event.key === "ArrowUp" ? -1 : 1;

        if (store.selection.kind === "row") {
          const rowId = store.selection.id;
          const row = doc.rows.find((candidate) => candidate.id === rowId);
          if (!row) return;
          event.preventDefault();

          // Move within the lane's own group, since a keystroke should not
          // silently re-parent it.
          const siblings = doc.rows.filter((candidate) => candidate.groupId === row.groupId);
          const index = siblings.findIndex((candidate) => candidate.id === rowId);
          const target = index + direction;
          if (target < 0 || target >= siblings.length) return;

          commands.reorderRow(
            rowId,
            row.groupId,
            direction === -1 ? (siblings[target]?.id ?? null) : (siblings[target + 1]?.id ?? null),
          );
          return;
        }

        if (store.selection.kind === "group") {
          const groupId = store.selection.id;
          const index = doc.groups.findIndex((candidate) => candidate.id === groupId);
          const target = index + direction;
          if (index === -1 || target < 0 || target >= doc.groups.length) return;
          event.preventDefault();

          commands.reorderGroup(
            groupId,
            direction === -1 ? (doc.groups[target]?.id ?? null) : (doc.groups[target + 1]?.id ?? null),
          );
          return;
        }
      }

      if (event.key === "Escape") {
        store.select({ kind: "none" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
