import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { formatWithPrecision } from "@/lib/dates";
import { commands, useEditorStore } from "@/state/editor-store";
import { cardFill, cardInk } from "./colors";
import type { PlacedItem } from "./geometry";

export type DragMode = "move" | "resize-start" | "resize-end" | "link";

export interface TimelineCardProps {
  placed: PlacedItem;
  selected: boolean;
  readOnly: boolean;
  /** True while this card is a candidate target for a link being dragged. */
  linkTarget: boolean;
  editing: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (mode: DragMode, placed: PlacedItem, event: ReactPointerEvent) => void;
  onHover: (placed: PlacedItem | null, clientX: number, clientY: number) => void;
}

/** Reads the item's dates the way its precision means them. */
export function describeRange(placed: PlacedItem): string {
  const { item } = placed;
  return item.kind === "milestone"
    ? formatWithPrecision(item.start, item.precision)
    : `${formatWithPrecision(item.start, item.precision)} – ${formatWithPrecision(item.end, item.precision)}`;
}

/**
 * Renames a card in place. Double-clicking the thing you want to rename is the
 * shortest path there is, and it keeps the inspector's title field in sync
 * because both write through the same command.
 */
function TitleEditor({
  placed,
  className,
  style,
}: {
  placed: PlacedItem;
  className?: string;
  style?: React.CSSProperties;
}) {
  const setEditing = useEditorStore((state) => state.setEditing);
  const [draft, setDraft] = useState(placed.item.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (): void => {
    const next = draft.trim();
    if (next && next !== placed.item.title) commands.updateItem(placed.item.id, { title: next });
    setEditing(null);
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        // Escape abandons the edit rather than saving a half-typed title.
        if (event.key === "Escape") setEditing(null);
      }}
      className={cn(
        "min-w-0 rounded-[4px] bg-raised px-1 text-label text-ink outline-none",
        "ring-2 ring-accent",
        className,
      )}
      style={style}
    />
  );
}

export const TimelineCard = memo(function TimelineCard({
  placed,
  selected,
  readOnly,
  linkTarget,
  editing,
  onSelect,
  onDragStart,
  onHover,
}: TimelineCardProps) {
  const { item } = placed;
  const setEditing = useEditorStore((state) => state.setEditing);
  const fill = cardFill(item.color);
  const ink = cardInk(item.color);
  const range = describeRange(placed);

  const hoverProps = {
    onPointerEnter: (event: ReactPointerEvent) => onHover(placed, event.clientX, event.clientY),
    onPointerMove: (event: ReactPointerEvent) => onHover(placed, event.clientX, event.clientY),
    onPointerLeave: () => onHover(null, 0, 0),
  };

  const beginEdit = (): void => {
    if (!readOnly) setEditing(item.id);
  };

  /*
   * Where the title goes was decided by the packer, not here - it had to be, so
   * the space the label occupies could be reserved before anything was placed.
   */
  const externalLabel = placed.labelSide !== "inside";
  const labelStyle: React.CSSProperties =
    placed.labelSide === "left"
      ? { right: "100%", marginRight: 8, textAlign: "right" }
      : { left: "100%", marginLeft: 8 };

  /* ------------------------------------------------------------ milestone -- */
  if (item.kind === "milestone") {
    const size = placed.height * 0.62;
    return (
      <div
        className="absolute flex items-center transition-[top] duration-[var(--dur-fast)] ease-standard"
        style={{ left: placed.x, top: placed.y, height: placed.height }}
        {...hoverProps}
      >
        <button
          type="button"
          aria-label={`${item.title}, milestone on ${range}`}
          onPointerDown={(event) => {
            if (readOnly || event.button !== 0) return;
            onSelect(item.id, event.shiftKey);
            onDragStart("move", placed, event);
          }}
          onDoubleClick={beginEdit}
          className={cn(
            "relative shrink-0 rotate-45 rounded-[3px] shadow-1",
            "transition-[box-shadow,transform] duration-[var(--dur-fast)] ease-standard",
            !readOnly && "cursor-grab active:cursor-grabbing",
            selected && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface-sunken)]",
            linkTarget && "ring-2 ring-accent",
          )}
          style={{ width: size, height: size, backgroundColor: fill }}
        />
        {editing ? (
          <TitleEditor placed={placed} className="ml-2 w-40" />
        ) : (
          <span
            onDoubleClick={beginEdit}
            className={cn(
              "ml-2 whitespace-nowrap text-caption text-ink",
              placed.labelSide === "left" && "order-first ml-0 mr-2",
              readOnly ? "pointer-events-none" : "cursor-text",
            )}
          >
            {item.title}
          </span>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------------ bar -- */
  return (
    <div
      // `top` eases so a card glides when its lane moves or it is pushed onto
      // another sub-line. `left` deliberately does not - while dragging, the
      // card must track the pointer exactly.
      className="group absolute flex items-center transition-[top] duration-[var(--dur-fast)] ease-standard"
      style={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
      {...hoverProps}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${item.title}, ${range}`}
        onPointerDown={(event) => {
          if (readOnly || event.button !== 0) return;
          onSelect(item.id, event.shiftKey);
          onDragStart("move", placed, event);
        }}
        onDoubleClick={beginEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            beginEdit();
          }
        }}
        className={cn(
          "relative h-full w-full overflow-hidden rounded-md shadow-1",
          "transition-[box-shadow,filter] duration-[var(--dur-fast)] ease-standard",
          !readOnly && "cursor-grab active:cursor-grabbing",
          "hover:brightness-[1.06]",
          // Selection is a ring, never a colour change - the colour is carrying
          // the grouping and must not shift when a card is picked.
          selected && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface-sunken)]",
          linkTarget && "ring-2 ring-accent",
        )}
        style={{ backgroundColor: fill }}
      >
        {item.progress !== undefined && item.progress > 0 ? (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 bg-black/20"
            style={{ width: `${Math.min(1, item.progress) * 100}%` }}
          />
        ) : null}

        {!externalLabel && !editing ? (
          <span
            className="pointer-events-none relative flex h-full items-center truncate-1 px-2 text-label"
            style={{ color: ink }}
          >
            {item.title}
          </span>
        ) : null}
      </div>

      {/* The title, when it did not fit inside. */}
      {externalLabel && !editing ? (
        <span
          onDoubleClick={beginEdit}
          className={cn(
            "absolute whitespace-nowrap text-caption text-ink",
            readOnly ? "pointer-events-none" : "cursor-text",
          )}
          style={labelStyle}
        >
          {item.title}
        </span>
      ) : null}

      {editing ? (
        <TitleEditor
          placed={placed}
          className="absolute"
          style={
            externalLabel
              ? { ...labelStyle, width: Math.max(140, placed.labelWidth) }
              : { left: 2, right: 2 }
          }
        />
      ) : null}

      {!readOnly ? (
        <>
          {/* Resize grips. Wider than they look so they are actually grabbable. */}
          <span
            role="separator"
            aria-label="Change start date"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onSelect(item.id, false);
              onDragStart("resize-start", placed, event);
            }}
            className={cn(
              "absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md",
              "opacity-0 transition-opacity duration-[var(--dur-fast)]",
              "group-hover:opacity-100 group-hover:bg-black/15",
            )}
          />
          <span
            role="separator"
            aria-label="Change end date"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onSelect(item.id, false);
              onDragStart("resize-end", placed, event);
            }}
            className={cn(
              "absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md",
              "opacity-0 transition-opacity duration-[var(--dur-fast)]",
              "group-hover:opacity-100 group-hover:bg-black/15",
            )}
          />

          {/* Link handle, on the finishing edge where a dependency starts. */}
          <button
            type="button"
            aria-label={`Link from ${item.title}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onDragStart("link", placed, event);
            }}
            className={cn(
              "absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full",
              "border-2 border-[var(--surface-sunken)] bg-accent",
              "opacity-0 transition-opacity duration-[var(--dur-fast)]",
              "group-hover:opacity-100 focus-visible:opacity-100",
              selected && "opacity-100",
            )}
          />
        </>
      ) : null}
    </div>
  );
});
