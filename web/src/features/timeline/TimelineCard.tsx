import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { formatWithPrecision } from "@/lib/dates";
import { cardFill, cardInk } from "./colors";
import type { PlacedItem } from "./geometry";

export type DragMode = "move" | "resize-start" | "resize-end" | "link";

export interface TimelineCardProps {
  placed: PlacedItem;
  selected: boolean;
  readOnly: boolean;
  /** True while this card is a candidate target for a link being dragged. */
  linkTarget: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (mode: DragMode, placed: PlacedItem, event: ReactPointerEvent) => void;
  onOpenInspector: (id: string) => void;
}

/** Below this width a bar cannot hold a readable label, so it moves outside. */
const INLINE_LABEL_MIN_WIDTH = 56;

export const TimelineCard = memo(function TimelineCard({
  placed,
  selected,
  readOnly,
  linkTarget,
  onSelect,
  onDragStart,
  onOpenInspector,
}: TimelineCardProps) {
  const { item } = placed;
  const fill = cardFill(item.color);
  const ink = cardInk(item.color);
  const range =
    item.kind === "milestone"
      ? formatWithPrecision(item.start, item.precision)
      : `${formatWithPrecision(item.start, item.precision)} – ${formatWithPrecision(item.end, item.precision)}`;

  /* ------------------------------------------------------------ milestone -- */
  if (item.kind === "milestone") {
    const size = placed.height * 0.62;
    return (
      <div
        className="absolute flex items-center"
        style={{ left: placed.x, top: placed.y, height: placed.height }}
      >
        <button
          type="button"
          aria-label={`${item.title}, milestone on ${range}`}
          onPointerDown={(event) => {
            if (readOnly || event.button !== 0) return;
            onSelect(item.id, event.shiftKey);
            onDragStart("move", placed, event);
          }}
          onDoubleClick={() => onOpenInspector(item.id)}
          className={cn(
            "relative shrink-0 rotate-45 rounded-[3px] shadow-1",
            "transition-[box-shadow,transform] duration-[var(--dur-fast)] ease-standard",
            !readOnly && "cursor-grab active:cursor-grabbing",
            selected && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface-sunken)]",
            linkTarget && "ring-2 ring-accent",
          )}
          style={{ width: size, height: size, backgroundColor: fill }}
        />
        {/*
          A milestone is a point, so its label always sits beside it - there is
          no inside to put it in.
        */}
        <span className="pointer-events-none ml-2 whitespace-nowrap text-caption text-ink">
          {item.title}
        </span>
      </div>
    );
  }

  /* ------------------------------------------------------------------ bar -- */
  const showInlineLabel = placed.width >= INLINE_LABEL_MIN_WIDTH;

  return (
    <div
      className="group absolute flex items-center"
      style={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
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
        onDoubleClick={() => onOpenInspector(item.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenInspector(item.id);
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

        {showInlineLabel ? (
          <span
            className="pointer-events-none relative flex h-full items-center truncate-1 px-2 text-label"
            style={{ color: ink }}
          >
            {item.title}
          </span>
        ) : null}
      </div>

      {!showInlineLabel ? (
        <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap text-caption text-ink">
          {item.title}
        </span>
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
