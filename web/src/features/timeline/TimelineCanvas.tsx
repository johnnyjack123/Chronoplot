import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent,
} from "react";
import type { TimelineDoc } from "@shared";
import { cn } from "@/lib/cn";
import { addDays, clampDate, daysBetween, snapToPrecision, today } from "@/lib/dates";
import { commands, useEditorStore } from "@/state/editor-store";
import { IconButton } from "@/components/ui/Button";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { PlotBackground, TimeAxis } from "./Axis";
import { LinkLayer, PendingLink } from "./Links";
import { TimelineCard, type DragMode } from "./TimelineCard";
import {
  buildAxis, clampToWindow, clampZoom, dateAtX, laneAtY, layout as computeLayout, snapDrag, xOf,
  DEFAULT_LAYOUT, SIDEBAR_WIDTH, type PlacedItem,
} from "./geometry";

/*
 * The editing surface.
 *
 * All interaction is pointer-based rather than HTML5 drag-and-drop: a timeline
 * needs continuous positional feedback, and the native drag API gives neither
 * reliable coordinates nor a usable drag image. Pointer capture also means a
 * drag keeps working when the cursor leaves the window.
 */

type DragState =
  | null
  | {
      kind: "move" | "resize-start" | "resize-end";
      itemId: string;
      pointerStartX: number;
      originStart: string;
      originEnd: string;
      originRowId: string;
    }
  | { kind: "link"; fromId: string; x: number; y: number; overItemId: string | null }
  | { kind: "create"; rowId: string; anchor: string; current: string };

/**
 * How far beyond the visible edges to keep drawing. Enough that a fast scroll
 * never reaches un-rendered space before the next frame fills it in.
 */
const OVERSCAN = 900;

export function TimelineCanvas({ doc, readOnly }: { doc: TimelineDoc; readOnly: boolean }) {
  const unitsPerDay = useEditorStore((state) => state.unitsPerDay);
  const selection = useEditorStore((state) => state.selection);
  const select = useEditorStore((state) => state.select);
  const setZoom = useEditorStore((state) => state.setZoom);

  const plotRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);

  /*
   * The scrolled viewport, tracked so the axis can be built for just the slice
   * on screen. Without this, a century-long timeline builds and mounts tens of
   * thousands of gridlines on every render and the editor locks up.
   */
  const [view, setView] = useState({ scrollLeft: 0, width: 1200 });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let frame = 0;
    const measure = (): void => {
      frame = 0;
      // The toolbar's "fit" needs the plot width, and this is the only place
      // that actually knows it.
      useEditorStore.getState().setPlotWidth(Math.max(120, element.clientWidth - SIDEBAR_WIDTH));
      setView((previous) =>
        previous.scrollLeft === element.scrollLeft && previous.width === element.clientWidth
          ? previous
          : { scrollLeft: element.scrollLeft, width: element.clientWidth },
      );
    };
    // Coalesce to one measurement per frame; scroll fires far more often.
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      element.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, []);

  const layout = useMemo(
    () => computeLayout(doc, { ...DEFAULT_LAYOUT, unitsPerDay }),
    [doc, unitsPerDay],
  );

  /** Visible slice of the plot, in plot-local units. */
  const windowFromX = Math.max(0, view.scrollLeft - OVERSCAN);
  const windowToX = view.scrollLeft + Math.max(0, view.width - SIDEBAR_WIDTH) + OVERSCAN;

  const axis = useMemo(
    () => buildAxis(doc, unitsPerDay, { fromX: windowFromX, toX: windowToX }),
    [doc, unitsPerDay, windowFromX, windowToX],
  );

  const selectedItemId = selection.kind === "item" ? selection.id : null;
  const todayIso = today();
  const todayPos =
    doc.settings.showToday && todayIso >= doc.settings.start && todayIso <= doc.settings.end
      ? xOf(todayIso, doc.settings.start, unitsPerDay)
      : null;

  /** Pointer position in plot coordinates. */
  const localPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = plotRef.current?.getBoundingClientRect();
    return {
      x: (event.clientX - (rect?.left ?? 0)),
      y: (event.clientY - (rect?.top ?? 0)),
    };
  }, []);

  /* ------------------------------------------------------------- dragging -- */

  const onCardDragStart = useCallback(
    (mode: DragMode, placed: PlacedItem, event: ReactPointerEvent) => {
      event.preventDefault();
      plotRef.current?.setPointerCapture(event.pointerId);

      if (mode === "link") {
        const point = localPoint(event);
        setDrag({ kind: "link", fromId: placed.item.id, x: point.x, y: point.y, overItemId: null });
        return;
      }

      setDrag({
        kind: mode,
        itemId: placed.item.id,
        pointerStartX: event.clientX,
        originStart: placed.item.start,
        originEnd: placed.item.end,
        originRowId: placed.item.rowId,
      });
    },
    [localPoint],
  );

  const onPlotPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (readOnly || event.button !== 0) return;
      // Only an empty part of the plot starts a create-drag; cards handle their
      // own pointer events and stop propagation implicitly by being on top.
      if (event.target !== event.currentTarget) return;

      const point = localPoint(event);
      const lane = laneAtY(layout, point.y);
      if (!lane) {
        select({ kind: "none" });
        return;
      }

      const date = clampDate(
        dateAtX(point.x, doc.settings.start, unitsPerDay),
        doc.settings.start,
        doc.settings.end,
      );
      plotRef.current?.setPointerCapture(event.pointerId);
      setDrag({ kind: "create", rowId: lane.rowId, anchor: date, current: date });
      select({ kind: "none" });
    },
    [doc.settings.end, doc.settings.start, layout, localPoint, readOnly, select, unitsPerDay],
  );

  const onPlotPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!drag) return;
      const point = localPoint(event);

      if (drag.kind === "link") {
        const lane = laneAtY(layout, point.y);
        const over =
          lane?.items.find(
            (candidate) =>
              point.x >= candidate.x &&
              point.x <= candidate.x + Math.max(candidate.width, 12) &&
              candidate.item.id !== drag.fromId,
          )?.item.id ?? null;
        setDrag({ ...drag, x: point.x, y: point.y, overItemId: over });
        return;
      }

      if (drag.kind === "create") {
        const date = clampDate(
          dateAtX(point.x, doc.settings.start, unitsPerDay),
          doc.settings.start,
          doc.settings.end,
        );
        if (date !== drag.current) setDrag({ ...drag, current: date });
        return;
      }

      const item = doc.items.find((candidate) => candidate.id === drag.itemId);
      if (!item) return;

      const deltaDays = Math.round((event.clientX - drag.pointerStartX) / unitsPerDay);

      if (drag.kind === "move") {
        const moved = snapDrag(
          { ...item, start: drag.originStart, end: drag.originEnd },
          deltaDays,
          item.precision,
        );
        const bounded = clampToWindow(moved.start, moved.end, doc.settings.start, doc.settings.end);

        // Dragging vertically re-parents the card into whichever lane the
        // pointer is over, which is how a card moves between rows.
        const lane = laneAtY(layout, point.y);
        const rowId = lane?.rowId ?? drag.originRowId;

        commands.updateItem(
          drag.itemId,
          { start: bounded.start, end: bounded.end, rowId },
          `move:${drag.itemId}`,
        );
        return;
      }

      if (drag.kind === "resize-start") {
        const raw = addDays(drag.originStart, deltaDays);
        const snapped = snapToPrecision(raw, item.precision, "start");
        const next = clampDate(snapped, doc.settings.start, item.end);
        commands.updateItem(drag.itemId, { start: next }, `resize:${drag.itemId}`);
        return;
      }

      const raw = addDays(drag.originEnd, deltaDays);
      const snapped = snapToPrecision(raw, item.precision, "end");
      const next = clampDate(snapped, item.start, doc.settings.end);
      commands.updateItem(drag.itemId, { end: next }, `resize:${drag.itemId}`);
    },
    [doc.items, doc.settings.end, doc.settings.start, drag, layout, localPoint, unitsPerDay],
  );

  const onPlotPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      if (!drag) return;
      plotRef.current?.releasePointerCapture(event.pointerId);

      if (drag.kind === "link") {
        if (drag.overItemId) commands.linkItems(drag.fromId, drag.overItemId);
      } else if (drag.kind === "create") {
        const start = drag.anchor <= drag.current ? drag.anchor : drag.current;
        const end = drag.anchor <= drag.current ? drag.current : drag.anchor;
        // A click without movement creates a milestone; a drag creates a bar.
        // That is a real shortcut rather than a guess: dragging out a zero-width
        // bar is meaningless, and a point in time is exactly a milestone.
        const isPoint = daysBetween(start, end) === 0;
        const id = commands.addItem({
          rowId: drag.rowId,
          kind: isPoint ? "milestone" : "bar",
          title: isPoint ? "Milestone" : "New card",
          start,
          end: isPoint ? start : end,
          precision: "day",
        });
        select({ kind: "item", id });
      }

      setDrag(null);
    },
    [drag, select],
  );

  /*
   * Ctrl/Cmd + wheel zooms around the pointer, the way every map and design
   * tool behaves. Anchoring on the cursor matters at these zoom ranges: without
   * it, zooming out from year ten thousand throws the view somewhere unrelated.
   */
  const onWheel = useCallback(
    (event: ReactWheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      const container = scrollRef.current;
      const plot = plotRef.current;
      if (!container || !plot) return;

      const pointerPlotX = event.clientX - plot.getBoundingClientRect().left;
      const next = clampZoom(unitsPerDay * Math.exp(-event.deltaY * 0.0015));
      if (next === unitsPerDay) return;

      setZoom(next);
      // Keep the day under the cursor under the cursor.
      const ratio = next / unitsPerDay;
      container.scrollLeft += pointerPlotX * (ratio - 1);
    },
    [setZoom, unitsPerDay],
  );

  // React attaches wheel listeners passively, which forbids preventDefault, so
  // the zoom handler has to be registered directly.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const handler = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  }, []);

  /* ------------------------------------------------------------ rendering -- */

  const createPreview =
    drag?.kind === "create"
      ? (() => {
          const start = drag.anchor <= drag.current ? drag.anchor : drag.current;
          const end = drag.anchor <= drag.current ? drag.current : drag.anchor;
          const lane = layout.lanes.find((candidate) => candidate.rowId === drag.rowId);
          if (!lane) return null;
          return {
            x: xOf(start, doc.settings.start, unitsPerDay),
            width: (daysBetween(start, end) + 1) * unitsPerDay,
            y: lane.y + layout.options.lanePadding,
            height: layout.options.cardHeight,
          };
        })()
      : null;

  const linkSource =
    drag?.kind === "link"
      ? layout.lanes.flatMap((lane) => lane.items).find((placed) => placed.item.id === drag.fromId)
      : undefined;

  return (
    <div ref={scrollRef} onWheel={onWheel} className="relative flex-1 overflow-auto bg-sunken">
      <div
        className="relative"
        style={{ width: SIDEBAR_WIDTH + layout.totalWidth, minWidth: "100%" }}
      >
        {/* Header row: the corner cell plus the time axis, pinned to the top. */}
        <div className="sticky top-0 z-[var(--z-sticky)] flex">
          <div
            className="sticky left-0 z-[var(--z-sticky)] shrink-0 border-b border-r border-line-strong bg-surface"
            style={{ width: SIDEBAR_WIDTH, height: "var(--axis-height)" }}
          >
            <div className="flex h-full items-end px-3 pb-2">
              <span className="text-micro uppercase text-ink-subtle">Lanes</span>
            </div>
          </div>
          <TimeAxis axis={axis} width={layout.totalWidth} />
        </div>

        <div className="flex">
          {/* Lane and group names, pinned to the left. */}
          <div
            className="sticky left-0 z-[var(--z-sticky)] shrink-0 border-r border-line-strong bg-surface"
            style={{ width: SIDEBAR_WIDTH, height: layout.totalHeight }}
          >
            <LaneList doc={doc} layout={layout} readOnly={readOnly} />
          </div>

          {/* The plot itself. */}
          <div
            ref={plotRef}
            onPointerDown={onPlotPointerDown}
            onPointerMove={onPlotPointerMove}
            onPointerUp={onPlotPointerUp}
            onPointerCancel={onPlotPointerUp}
            className={cn(
              "relative shrink-0 touch-none",
              !readOnly && drag === null && "cursor-crosshair",
            )}
            style={{ width: layout.totalWidth, height: layout.totalHeight }}
          >
            <PlotBackground axis={axis} width={layout.totalWidth} height={layout.totalHeight} />

            {/*
              Lane separators and group bands are decoration only. Without
              pointer-events-none a band would sit on top of its own lanes and
              swallow the pointerdown that starts a drag-to-create, so cards
              could not be drawn inside a group at all.
            */}
            {layout.groups.map((group) => (
              <div
                key={`band-${group.groupId}`}
                aria-hidden
                className="pointer-events-none absolute left-0 bg-ink/[0.02]"
                style={{ top: group.y, height: group.height, width: layout.totalWidth }}
              />
            ))}
            {layout.lanes.map((lane) => (
              <div
                key={`sep-${lane.rowId}`}
                aria-hidden
                className="pointer-events-none absolute left-0 h-px bg-line"
                style={{ top: lane.y + lane.height, width: layout.totalWidth }}
              />
            ))}

            {doc.settings.showLinks ? (
              <LinkLayer
                links={doc.links}
                layout={layout}
                width={layout.totalWidth}
                height={layout.totalHeight}
                highlightItemId={selectedItemId}
              />
            ) : null}

            {/*
              Only cards intersecting the visible slice are mounted. Zoomed in
              on a long timeline the document may hold thousands, and mounting
              them all costs far more than the filter does.
            */}
            {layout.lanes.flatMap((lane) =>
              lane.items
                .filter(
                  (placed) =>
                    placed.x + Math.max(placed.width, 160) >= windowFromX && placed.x <= windowToX,
                )
                .map((placed) => (
                  <TimelineCard
                    key={placed.item.id}
                    placed={placed}
                    selected={selectedItemId === placed.item.id}
                    readOnly={readOnly}
                    linkTarget={drag?.kind === "link" && drag.overItemId === placed.item.id}
                    onSelect={(id) => select({ kind: "item", id })}
                    onDragStart={onCardDragStart}
                    onOpenInspector={(id) => select({ kind: "item", id })}
                  />
                )),
            )}

            {createPreview ? (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-md border-2 border-dashed border-accent bg-accent/15"
                style={createPreview}
              />
            ) : null}

            {linkSource && drag?.kind === "link" ? (
              <PendingLink from={linkSource} x={drag.x} y={drag.y} />
            ) : null}

            {todayPos !== null ? <TodayMarker x={todayPos} height={layout.totalHeight} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The "today" line, with a small head so it reads as a marker, not a gridline. */
function TodayMarker({ x, height }: { x: number; height: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 z-[var(--z-plot)]"
      style={{ left: x, height }}
    >
      <div className="absolute -left-px top-0 w-0.5 bg-accent/70" style={{ height }} />
      <div className="absolute -left-1 -top-1 size-2.5 rounded-full bg-accent shadow-1">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- sidebar -- */

function LaneList({
  doc,
  layout,
  readOnly,
}: {
  doc: TimelineDoc;
  layout: ReturnType<typeof computeLayout>;
  readOnly: boolean;
}) {
  const selection = useEditorStore((state) => state.selection);
  const select = useEditorStore((state) => state.select);

  return (
    <>
      {layout.groups.map((group) => (
        <div
          key={group.groupId}
          className="absolute left-0 right-0 flex items-center gap-1 border-b border-line px-2"
          style={{ top: group.y, height: layout.options.groupHeaderHeight }}
        >
          <IconButton
            label={group.collapsed ? `Expand ${group.title}` : `Collapse ${group.title}`}
            size="sm"
            className="size-6"
            onClick={() => commands.toggleGroup(group.groupId)}
          >
            {group.collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          </IconButton>
          <button
            type="button"
            onClick={() => select({ kind: "group", id: group.groupId })}
            className={cn(
              "min-w-0 flex-1 truncate-1 rounded-sm px-1 py-0.5 text-left text-micro uppercase",
              selection.kind === "group" && selection.id === group.groupId
                ? "text-accent"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {group.title}
          </button>
          {group.collapsed ? (
            <span className="tabular shrink-0 rounded-full bg-accent-soft px-1.5 text-micro text-ink-muted">
              {group.laneCount}
            </span>
          ) : !readOnly ? (
            <IconButton
              label={`Add lane to ${group.title}`}
              size="sm"
              className="size-6"
              onClick={() => commands.addRowToGroup(group.groupId)}
            >
              <PlusIcon />
            </IconButton>
          ) : null}
        </div>
      ))}

      {layout.lanes.map((lane) => {
        const selected = selection.kind === "row" && selection.id === lane.rowId;
        const indented = lane.groupId !== null;
        return (
          <div
            key={lane.rowId}
            className="absolute left-0 right-0 flex items-center border-b border-line"
            style={{ top: lane.y, height: lane.height }}
          >
            <button
              type="button"
              onClick={() => select({ kind: "row", id: lane.rowId })}
              className={cn(
                "mx-2 min-w-0 flex-1 truncate-1 rounded-sm px-1.5 py-1 text-left text-label",
                indented && "ml-6",
                selected ? "bg-accent-soft text-accent" : "text-ink hover:bg-accent-soft/60",
              )}
            >
              {lane.title}
            </button>
            <span className="tabular mr-2 shrink-0 text-micro text-ink-subtle">
              {lane.items.length || ""}
            </span>
          </div>
        );
      })}

      {layout.lanes.length === 0 && doc.groups.length === 0 ? (
        <p className="px-3 py-4 text-caption text-ink-subtle">No lanes yet.</p>
      ) : null}
    </>
  );
}
