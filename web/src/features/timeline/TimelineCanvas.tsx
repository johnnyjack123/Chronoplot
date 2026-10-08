import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent,
} from "react";
import type { TimelineDoc } from "@shared";
import { cn } from "@/lib/cn";
import { addDays, clampDate, daysBetween, inclusiveDays, snapToPrecision, today } from "@/lib/dates";
import { commands, useEditorStore } from "@/state/editor-store";
import { Button, IconButton } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Popover";
import {
  ChevronDownIcon, ChevronRightIcon, GripIcon, GroupIcon, MinusIcon, PlusIcon,
} from "@/components/icons";
import { PlotBackground, TimeAxis } from "./Axis";
import { laneTint } from "./colors";
import { LinkLayer, PendingLink } from "./Links";
import { TimelineCard, describeRange, type DragMode } from "./TimelineCard";
import {
  buildAxis, canRemoveSubLane, clampToWindow, clampZoom, collectSnapTargets, dateAtX,
  fitUnitsPerDay, laneAtY, layout as computeLayout, snapDrag, snapOffsetDays, subLaneAt, xOf,
  DEFAULT_LAYOUT, SIDEBAR_WIDTH, type LayoutOptions, type PlacedItem, type PlacedLane,
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
      /** Sub-lane the card was drawn on when the drag began. */
      originStack: number;
      /** The card's own pin when the drag began, so returning home restores it. */
      originSubLane: number | undefined;
      /** True once this drag has aimed at a different sub-lane or lane. */
      steered: boolean;
      /** Date the drag latched onto, shown as a guide line while it holds. */
      snappedTo: string | null;
    }
  | { kind: "link"; fromId: string; x: number; y: number; overItemId: string | null }
  | { kind: "create"; rowId: string; anchor: string; current: string };

/**
 * How far beyond the visible edges to keep drawing. Enough that a fast scroll
 * never reaches un-rendered space before the next frame fills it in.
 */
const OVERSCAN = 900;

/**
 * Scrollable space past the end of the timeline.
 *
 * Without it the last day sits flush against the panel on the right, and the
 * labels that narrow cards and milestones draw *beside* themselves are clipped
 * with nowhere to scroll to.
 */
const END_GUTTER = 180;

export function TimelineCanvas({ doc, readOnly }: { doc: TimelineDoc; readOnly: boolean }) {
  const unitsPerDay = useEditorStore((state) => state.unitsPerDay);
  const selection = useEditorStore((state) => state.selection);
  const select = useEditorStore((state) => state.select);
  const setZoom = useEditorStore((state) => state.setZoom);
  const snapping = useEditorStore((state) => state.snapping);
  const editingId = useEditorStore((state) => state.editingId);
  const viewCommand = useEditorStore((state) => state.viewCommand);
  const projectId = useEditorStore((state) => state.projectId);

  const plotRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [hover, setHover] = useState<{ placed: PlacedItem; x: number; y: number } | null>(null);

  const onHover = useCallback((placed: PlacedItem | null, x: number, y: number) => {
    setHover(placed ? { placed, x, y } : null);
  }, []);

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
        originStack: placed.stack,
        originSubLane: placed.item.subLane,
        steered: false,
        snappedTo: null,
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
      const snapTargets = snapping ? collectSnapTargets(doc, drag.itemId) : [];

      if (drag.kind === "move") {
        const moved = snapDrag(
          { ...item, start: drag.originStart, end: drag.originEnd },
          deltaDays,
          item.precision,
        );
        // Latch onto neighbouring edges once they are within a few pixels. The
        // threshold is in pixels rather than days so it feels identical whether
        // a day is forty pixels wide or a hundredth of one.
        const snap = snapping
          ? snapOffsetDays([moved.start, addDays(moved.end, 1)], snapTargets, unitsPerDay)
          : { days: 0, target: null };
        const snapped =
          snap.days === 0
            ? moved
            : { start: addDays(moved.start, snap.days), end: addDays(moved.end, snap.days) };

        if (drag.snappedTo !== snap.target) setDrag({ ...drag, snappedTo: snap.target });
        const bounded = clampToWindow(snapped.start, snapped.end, doc.settings.start, doc.settings.end);

        // Dragging vertically re-parents the card into whichever lane the
        // pointer is over, which is how a card moves between rows.
        const lane = laneAtY(layout, point.y);
        const rowId = lane?.rowId ?? drag.originRowId;

        commands.updateItem(
          drag.itemId,
          { start: bounded.start, end: bounded.end, rowId },
          `move:${drag.itemId}`,
        );

        /*
         * Aiming at a sub-lane pins the card there.
         *
         * A purely sideways drag must leave an unpinned card unpinned, or the
         * first nudge of every card would quietly freeze the whole timeline.
         * But the test for that used to be "is the aim different from where the
         * drag began", and that made the move one-way: having pinned a card to
         * sub-lane 1, aiming back at 0 matched the starting sub-lane, counted
         * as no change, and did nothing at all. The card could not be brought
         * back.
         *
         * So the trigger is whether this drag has moved vertically *at any
         * point*. Once it has, every position applies - including a return to
         * where it started, which restores the card to exactly the state it had
         * rather than pinning it where it already was.
         */
        if (lane) {
          const target = subLaneAt(lane, point.y, layout.options);
          const movedLane = rowId !== drag.originRowId;
          const aiming = movedLane || target !== drag.originStack;

          if (aiming || drag.steered) {
            const home = !movedLane && target === drag.originStack;
            commands.setSubLane(
              drag.itemId,
              home ? drag.originSubLane ?? null : target,
              `move:${drag.itemId}`,
            );
            if (!drag.steered) setDrag({ ...drag, steered: true });
          }
        }
        return;
      }

      if (drag.kind === "resize-start") {
        const raw = addDays(drag.originStart, deltaDays);
        const snap = snapOffsetDays([raw], snapTargets, unitsPerDay);
        if (drag.snappedTo !== snap.target) setDrag({ ...drag, snappedTo: snap.target });

        const next = clampDate(
          snapToPrecision(addDays(raw, snap.days), item.precision, "start"),
          doc.settings.start,
          item.end,
        );
        commands.updateItem(drag.itemId, { start: next }, `resize:${drag.itemId}`);
        return;
      }

      const raw = addDays(drag.originEnd, deltaDays);
      // The trailing edge sits a day before the target, so two cards butt up
      // against each other rather than overlapping by one day.
      const endSnap = snapOffsetDays([addDays(raw, 1)], snapTargets, unitsPerDay);
      if (drag.snappedTo !== endSnap.target) setDrag({ ...drag, snappedTo: endSnap.target });
      const aligned = addDays(raw, endSnap.days);
      const next = clampDate(
        snapToPrecision(aligned, item.precision, "end"),
        item.start,
        doc.settings.end,
      );
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
        /*
         * No precision here on purpose: addItem falls back to the one last
         * worked in, and naming "day" was what defeated that. Someone building
         * a timeline in years had every card they dragged come back as days.
         */
        const id = commands.addItem({
          rowId: drag.rowId,
          kind: isPoint ? "milestone" : "bar",
          title: isPoint ? "Milestone" : "New card",
          start,
          end: isPoint ? start : end,
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

  /*
   * Animated view changes.
   *
   * Zoom is interpolated geometrically, not linearly: doubling and halving
   * should feel like equal steps, and a linear ramp between 0.002 and 40 spends
   * almost all its time at the wide end. Scroll moves alongside it, which is
   * the part "fit" was missing - setting the zoom alone left the old scroll
   * offset in place, cutting off the left and leaving a gap on the right.
   */
  const animation = useRef(0);

  const animateView = useCallback((toZoom: number, toScrollLeft: number) => {
    const container = scrollRef.current;
    if (!container) return;
    cancelAnimationFrame(animation.current);

    const fromZoom = useEditorStore.getState().unitsPerDay;
    const fromScroll = container.scrollLeft;
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    if (reduced) {
      useEditorStore.getState().setZoom(toZoom);
      container.scrollLeft = toScrollLeft;
      return;
    }

    const started = performance.now();
    const DURATION = 380;
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      useEditorStore.getState().setZoom(fromZoom * Math.pow(toZoom / fromZoom, eased));
      container.scrollLeft = fromScroll + (toScrollLeft - fromScroll) * eased;
      if (t < 1) animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(animation.current), []);

  /*
   * The document is read through a ref rather than a dependency. As a
   * dependency it would re-run this effect on every edit, replaying the last
   * zoom command and yanking the view back mid-typing.
   */
  const docRef = useRef(doc);
  docRef.current = doc;

  /*
   * Open on the whole timeline.
   *
   * Landing at whatever zoom the previous project happened to use, scrolled to
   * wherever it was left, tells you nothing about the plan you just opened.
   * Done without animation - there is no previous view to animate away from -
   * and once per project, so it never fights a zoom you set yourself.
   */
  const fittedProject = useRef<string | null>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !projectId || fittedProject.current === projectId) return;

    fittedProject.current = projectId;
    // A frame later, so the container has been laid out and measured.
    const frame = requestAnimationFrame(() => {
      const available = Math.max(200, container.clientWidth - SIDEBAR_WIDTH);
      useEditorStore.getState().setZoom(fitUnitsPerDay(docRef.current, available));
      container.scrollLeft = 0;
      container.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [projectId]);

  useEffect(() => {
    if (!viewCommand) return;
    const container = scrollRef.current;
    if (!container) return;

    const available = Math.max(200, container.clientWidth - SIDEBAR_WIDTH);
    if (viewCommand.zoom === "fit") {
      // Fitting means "show all of it", so the view returns to the start as
      // well as zooming out - leaving the old scroll offset behind is what cut
      // off the left-hand side and left a gap on the right.
      animateView(fitUnitsPerDay(docRef.current, available), 0);
      return;
    }

    // A zoom step keeps whatever is in the middle of the view in the middle.
    const target = clampZoom(viewCommand.zoom);
    const ratio = target / useEditorStore.getState().unitsPerDay;
    const centre = container.scrollLeft + available / 2;
    animateView(target, Math.max(0, centre * ratio - available / 2));
  }, [viewCommand, animateView]);

  /* ------------------------------------------------------------ rendering -- */

  const createPreview =
    drag?.kind === "create"
      ? (() => {
          const start = drag.anchor <= drag.current ? drag.anchor : drag.current;
          const end = drag.anchor <= drag.current ? drag.current : drag.anchor;
          const lane = layout.lanes.find((candidate) => candidate.rowId === drag.rowId);
          if (!lane) return null;
          // `left`/`top`, not `x`/`y`: these go straight into a style object,
          // and x/y are not CSS properties - an absolutely positioned box with
          // neither left nor top falls back to its static position, which put
          // every drag preview at the far left of the plot instead of under the
          // pointer.
          return {
            left: xOf(start, doc.settings.start, unitsPerDay),
            width: (daysBetween(start, end) + 1) * unitsPerDay,
            top: lane.y + layout.options.lanePadding,
            height: layout.options.cardHeight,
          };
        })()
      : null;

  const snapLineX =
    drag !== null && drag.kind !== "link" && drag.kind !== "create" && drag.snappedTo !== null
      ? xOf(drag.snappedTo, doc.settings.start, unitsPerDay)
      : null;

  const linkSource =
    drag?.kind === "link"
      ? layout.lanes.flatMap((lane) => lane.items).find((placed) => placed.item.id === drag.fromId)
      : undefined;

  return (
    <div ref={scrollRef} onWheel={onWheel} className="relative flex-1 overflow-auto bg-sunken">
      <div
        className="relative"
        style={{ width: SIDEBAR_WIDTH + layout.totalWidth + END_GUTTER, minWidth: "100%" }}
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
            style={{ width: SIDEBAR_WIDTH, height: layout.totalHeight + LANE_FOOTER_HEIGHT }}
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
                className="pointer-events-none absolute left-0 bg-ink/[0.02] transition-[top,height] duration-[var(--dur-base)] ease-standard"
                style={{ top: group.y, height: group.height, width: layout.totalWidth }}
              />
            ))}
            {layout.lanes.map((lane) => (
              <div key={`lane-${lane.rowId}`}>
                {lane.color !== undefined ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute left-0 transition-[top,height] duration-[var(--dur-base)] ease-standard"
                    style={{
                      top: lane.y,
                      height: lane.height,
                      width: layout.totalWidth,
                      background: laneTint(lane.color),
                    }}
                  />
                ) : null}
                <div
                  aria-hidden
                  className="pointer-events-none absolute left-0 h-px bg-line transition-[top] duration-[var(--dur-base)] ease-standard"
                  style={{ top: lane.y + lane.height, width: layout.totalWidth }}
                />
              </div>
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
                    editing={editingId === placed.item.id}
                    onSelect={(id) => select({ kind: "item", id })}
                    onDragStart={onCardDragStart}
                    onHover={onHover}
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

            {/*
              Where the drag latched on. Without this the card simply jumps a
              few days and the reason is invisible.
            */}
            {snapLineX !== null ? (
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 z-[var(--z-drag)] w-0.5 -translate-x-1/2 bg-accent"
                style={{ left: snapLineX, height: layout.totalHeight }}
              >
                <span className="absolute -left-1 -top-1 size-2.5 rounded-full bg-accent" />
                <span className="absolute -left-1 -bottom-1 size-2.5 rounded-full bg-accent" />
              </div>
            ) : null}

            {todayPos !== null ? <TodayMarker x={todayPos} height={layout.totalHeight} /> : null}
          </div>
        </div>
      </div>

      {/*
        One tooltip for the whole plot, following the pointer. A tooltip
        component per card would mean thousands of listeners and portals on a
        busy timeline for something only ever visible once at a time.
      */}
      {hover && drag === null ? <HoverCard hover={hover} /> : null}
    </div>
  );
}

function HoverCard({ hover }: { hover: { placed: PlacedItem; x: number; y: number } }) {
  const { item } = hover.placed;
  // Flip to the left of the pointer near the right edge so the tooltip never
  // pushes itself off screen.
  const flip = hover.x > globalThis.innerWidth - 260;

  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-[var(--z-popover)] max-w-64 rounded-md border border-line",
        "bg-raised px-2.5 py-1.5 shadow-2",
      )}
      style={{
        left: flip ? undefined : hover.x + 14,
        right: flip ? globalThis.innerWidth - hover.x + 14 : undefined,
        top: hover.y + 16,
      }}
    >
      <p className="truncate-1 text-label text-ink">{item.title}</p>
      <p className="tabular mt-0.5 text-caption text-ink-muted">{describeRange(hover.placed)}</p>
      {item.kind === "bar" ? (
        <p className="tabular text-caption text-ink-subtle">
          {inclusiveDays(item.start, item.end)} day
          {inclusiveDays(item.start, item.end) === 1 ? "" : "s"}
          {item.progress ? ` · ${Math.round(item.progress * 100)}% done` : ""}
        </p>
      ) : null}
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

/**
 * Where a dragged lane or group would land. Slots sit at the boundaries between
 * rendered lanes rather than on them, because a drop means "go between these
 * two", not "replace this one".
 */
interface DropSlot {
  y: number;
  groupId: string | null;
  /** The lane to land in front of, or null for last in that group. */
  beforeRowId: string | null;
}

interface GroupSlot {
  y: number;
  beforeGroupId: string | null;
}

type SidebarDrag =
  | { kind: "row"; id: string; slot: DropSlot | null }
  | { kind: "group"; id: string; slot: GroupSlot | null };

/** Room below the last lane for the buttons that add another one. */
const LANE_FOOTER_HEIGHT = 48;

/**
 * Renames a lane or group in place. Double-clicking the label is where people
 * try first, and a new lane opens straight into this rather than being called
 * "Lane 4" until someone finds the inspector.
 */
function InlineName({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
}) {
  const setEditing = useEditorStore((state) => state.setEditing);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (): void => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    setEditing(null);
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setEditing(null);
      }}
      className={cn(
        "min-w-0 flex-1 rounded-sm bg-sunken px-1.5 py-1 text-label text-ink",
        "outline-none ring-2 ring-accent",
        className,
      )}
    />
  );
}

/**
 * Sub-lane count, with the two buttons that change it.
 *
 * It sits under the lane name rather than in the lane's properties because it
 * describes the shape of the row you are looking at - and because Remove has to
 * know whether removal is even possible, which only the computed layout can
 * say. Hidden on a lane that has just one and is not being pointed at, so a
 * simple timeline stays quiet.
 */
function SubLaneCounter({
  lane,
  options,
  readOnly,
}: {
  lane: PlacedLane;
  options: LayoutOptions;
  readOnly: boolean;
}) {
  if (readOnly) return null;

  const removable = canRemoveSubLane(lane, options);
  const quiet = lane.subLanes <= 1;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 pl-1 transition-opacity duration-[var(--dur-fast)]",
        quiet && "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
      )}
    >
      <Tooltip
        content={
          removable
            ? "Remove the last sub-lane"
            : lane.subLanes <= 1
              ? "There is only one sub-lane"
              : "The cards on the last sub-lane have nowhere to move up to"
        }
      >
        <span>
          <IconButton
            label="Remove the last sub-lane"
            size="sm"
            disabled={!removable}
            onClick={() => commands.removeSubLane(lane.rowId)}
          >
            <MinusIcon />
          </IconButton>
        </span>
      </Tooltip>

      <span className="tabular min-w-4 text-center text-micro text-ink-subtle">{lane.subLanes}</span>

      <Tooltip content="Add a sub-lane">
        <IconButton
          label="Add a sub-lane"
          size="sm"
          onClick={() => commands.addSubLane(lane.rowId)}
        >
          <PlusIcon />
        </IconButton>
      </Tooltip>
    </div>
  );
}

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
  const editingId = useEditorStore((state) => state.editingId);
  const setEditing = useEditorStore((state) => state.setEditing);

  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<SidebarDrag | null>(null);

  /*
   * Drop targets for lanes. A collapsed group is deliberately not a target:
   * dropping into one would make the lane vanish, which reads as data loss even
   * though nothing was lost.
   */
  const rowSlots = useMemo<DropSlot[]>(() => {
    const slots: DropSlot[] = [];
    const contexts: (string | null)[] = [
      null,
      ...doc.groups.filter((group) => !group.collapsed).map((group) => group.id),
    ];

    for (const context of contexts) {
      const lanes = layout.lanes.filter((lane) => lane.groupId === context);
      for (const lane of lanes) {
        slots.push({ y: lane.y, groupId: context, beforeRowId: lane.rowId });
      }
      const last = lanes[lanes.length - 1];
      if (last) {
        slots.push({ y: last.y + last.height, groupId: context, beforeRowId: null });
      } else if (context === null) {
        slots.push({ y: 0, groupId: null, beforeRowId: null });
      } else {
        // An empty group still needs somewhere to drop into.
        const placed = layout.groups.find((group) => group.groupId === context);
        if (placed) slots.push({ y: placed.y + placed.height, groupId: context, beforeRowId: null });
      }
    }
    return slots;
  }, [doc.groups, layout.groups, layout.lanes]);

  const groupSlots = useMemo<GroupSlot[]>(() => {
    const slots: GroupSlot[] = layout.groups.map((group) => ({
      y: group.y,
      beforeGroupId: group.groupId,
    }));
    const last = layout.groups[layout.groups.length - 1];
    if (last) slots.push({ y: last.y + last.height, beforeGroupId: null });
    return slots;
  }, [layout.groups]);

  const localY = (clientY: number): number =>
    clientY - (listRef.current?.getBoundingClientRect().top ?? 0);

  const nearest = <T extends { y: number }>(slots: T[], y: number): T | null =>
    slots.reduce<T | null>(
      (best, slot) => (best === null || Math.abs(slot.y - y) < Math.abs(best.y - y) ? slot : best),
      null,
    );

  const startDrag = (kind: "row" | "group", id: string) => (event: ReactPointerEvent) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    listRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind, id, slot: null } as SidebarDrag);
  };

  const onPointerMove = (event: ReactPointerEvent): void => {
    if (!drag) return;
    const y = localY(event.clientY);
    setDrag(
      drag.kind === "row"
        ? { ...drag, slot: nearest(rowSlots, y) }
        : { ...drag, slot: nearest(groupSlots, y) },
    );
  };

  const onPointerUp = (event: ReactPointerEvent): void => {
    if (!drag) return;
    listRef.current?.releasePointerCapture(event.pointerId);

    if (drag.kind === "row" && drag.slot) {
      commands.reorderRow(drag.id, drag.slot.groupId, drag.slot.beforeRowId);
    } else if (drag.kind === "group" && drag.slot) {
      commands.reorderGroup(drag.id, drag.slot.beforeGroupId);
    }
    setDrag(null);
  };

  const gripClass = cn(
    "flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-ink-subtle",
    "opacity-0 transition-opacity duration-[var(--dur-fast)]",
    "hover:bg-accent-soft hover:text-ink group-hover/row:opacity-100 focus-visible:opacity-100",
    "active:cursor-grabbing",
  );

  return (
    <div
      ref={listRef}
      className="relative h-full touch-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {layout.groups.map((group) => (
        <div
          key={group.groupId}
          className={cn(
            "group/row absolute left-0 right-0 flex items-center gap-1 border-b border-line px-2",
            // Lanes and groups ease into their new place instead of jumping, so
            // a reorder reads as a movement rather than a redraw.
            "transition-[top] duration-[var(--dur-base)] ease-standard",
            drag?.kind === "group" && drag.id === group.groupId && "opacity-40",
          )}
          style={{ top: group.y, height: layout.options.groupHeaderHeight }}
        >
          {!readOnly ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Reorder ${group.title}`}
              onPointerDown={startDrag("group", group.groupId)}
              className={gripClass}
            >
              <GripIcon className="size-3" />
            </span>
          ) : null}
          <Tooltip content={group.collapsed ? "Expand this group" : "Collapse this group"}>
            <IconButton
              label={group.collapsed ? `Expand ${group.title}` : `Collapse ${group.title}`}
              size="sm"
              className="size-6"
              onClick={() => commands.toggleGroup(group.groupId)}
            >
              {group.collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
            </IconButton>
          </Tooltip>
          {editingId === group.groupId ? (
            <InlineName
              value={group.title}
              onCommit={(next) => commands.renameGroup(group.groupId, next)}
            />
          ) : (
            <button
              type="button"
              onClick={() => select({ kind: "group", id: group.groupId })}
              onDoubleClick={() => !readOnly && setEditing(group.groupId)}
              className={cn(
                "min-w-0 flex-1 truncate-1 rounded-sm px-1 py-0.5 text-left text-micro uppercase",
                selection.kind === "group" && selection.id === group.groupId
                  ? "text-accent"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {group.title}
            </button>
          )}
          {group.collapsed ? (
            <span className="tabular shrink-0 rounded-full bg-accent-soft px-1.5 text-micro text-ink-muted">
              {group.laneCount}
            </span>
          ) : !readOnly ? (
            <Tooltip content={`Add a lane to ${group.title}`}>
              <IconButton
                label={`Add lane to ${group.title}`}
                size="sm"
                className="size-6"
                onClick={() => commands.addRowToGroup(group.groupId)}
              >
                <PlusIcon />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
      ))}

      {layout.lanes.map((lane) => {
        const selected = selection.kind === "row" && selection.id === lane.rowId;
        const indented = lane.groupId !== null;
        return (
          <div
            key={lane.rowId}
            className={cn(
              "group/row absolute left-0 right-0 flex flex-col justify-center border-b border-line pl-1.5",
              "transition-[top] duration-[var(--dur-base)] ease-standard",
              indented && "pl-5",
              drag?.kind === "row" && drag.id === lane.rowId && "opacity-40",
            )}
            // The same wash as the lane itself, so the name and the row it
            // labels are visibly one thing.
            style={{ top: lane.y, height: lane.height, background: laneTint(lane.color) }}
          >
            <div className="flex min-w-0 items-center gap-1">
            {!readOnly ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Reorder ${lane.title}`}
                onPointerDown={startDrag("row", lane.rowId)}
                className={gripClass}
              >
                <GripIcon className="size-3.5" />
              </span>
            ) : null}
            {editingId === lane.rowId ? (
              <InlineName
                value={lane.title}
                onCommit={(next) => commands.renameRow(lane.rowId, next)}
              />
            ) : (
              <button
                type="button"
                onClick={() => select({ kind: "row", id: lane.rowId })}
                onDoubleClick={() => !readOnly && setEditing(lane.rowId)}
                className={cn(
                  "min-w-0 flex-1 truncate-1 rounded-sm px-1.5 py-1 text-left text-label",
                  selected ? "bg-accent-soft text-accent" : "text-ink hover:bg-accent-soft/60",
                )}
              >
                {lane.title}
              </button>
            )}
            <span className="tabular mr-2 shrink-0 text-micro text-ink-subtle">
              {lane.items.length || ""}
            </span>
            </div>

            <SubLaneCounter lane={lane} options={layout.options} readOnly={readOnly} />
          </div>
        );
      })}

      {/* Where the drag would land. */}
      {drag?.slot ? (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 -translate-y-px bg-accent"
          style={{ top: drag.slot.y }}
        >
          <span className="absolute -left-0.5 -top-1 size-2.5 rounded-full bg-accent" />
        </div>
      ) : null}

      {/*
        Adding a lane belongs where the lanes end, not in the toolbar - up there
        it reads as a global action and gives no clue where the new lane will
        appear.
      */}
      {!readOnly ? (
        <div
          className="absolute left-0 right-0 flex items-center gap-1 px-2"
          style={{ top: layout.totalHeight, height: LANE_FOOTER_HEIGHT }}
        >
          <Button
            size="sm"
            icon={<PlusIcon />}
            className="flex-1"
            onClick={() => commands.addRow()}
          >
            Lane
          </Button>
          <Tooltip content="Add a group">
            <IconButton label="Add group" size="sm" onClick={() => commands.addGroup()}>
              <GroupIcon />
            </IconButton>
          </Tooltip>
        </div>
      ) : null}

      {layout.lanes.length === 0 && doc.groups.length === 0 ? (
        <p className="px-3 py-3 text-caption text-ink-subtle">No lanes yet.</p>
      ) : null}
    </div>
  );
}
