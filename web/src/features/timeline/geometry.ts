/*
 * Timeline geometry - the single source of truth for where everything sits.
 *
 * Both renderers consume this module: the React canvas on screen and the PDF
 * exporter. That is what makes the export trustworthy - "what you arranged is
 * what you print" is a property of sharing this code, not of trying to keep two
 * layout implementations in agreement.
 *
 * Units are abstract here. The screen renderer feeds it pixels; the exporter
 * feeds it millimetres. Nothing below assumes one or the other.
 */
import type { Granularity, Item, Precision, TimelineDoc } from "@shared";
import {
  addDays, addMonths, addYears, clampDate, daysBetween, endOfMonth, endOfQuarter, endOfYear,
  formatMonth, inclusiveDays, isoWeekNumber, isWeekend, quarterOf, startOfMonth,
  startOfQuarter, startOfWeek, startOfYear, toIso, toTime, today as todayIso, type IsoDate,
} from "@/lib/dates";

export interface LayoutOptions {
  /** Horizontal scale. The only zoom control the rest of the app needs. */
  unitsPerDay: number;
  cardHeight: number;
  /** Vertical gap between stacked cards inside one lane. */
  cardGap: number;
  /** Padding above and below the cards in a lane. */
  lanePadding: number;
  groupHeaderHeight: number;
  /** Gap below a group's last lane, before the next group starts. */
  groupGap: number;

  /*
   * Label metrics. A title that does not fit inside its bar is drawn beside it,
   * and that text occupies space just as the bar does - so the packer has to
   * know how wide it will be. These are in the caller's units, which is why the
   * exporter supplies millimetre values.
   */
  /** Average glyph advance, used to estimate a label's width without measuring. */
  labelCharWidth: number;
  /** Space between a bar and a label drawn beside it. */
  labelGap: number;
  /** Smallest clear space left between two items on the same sub-line. */
  minItemGap: number;
  /** Horizontal padding for a label drawn inside its bar. */
  labelInset: number;
};

export const DEFAULT_LAYOUT: LayoutOptions = {
  unitsPerDay: 3,
  cardHeight: 32,
  cardGap: 6,
  lanePadding: 6,
  groupHeaderHeight: 28,
  groupGap: 12,
  labelCharWidth: 6.6,
  labelGap: 8,
  minItemGap: 6,
  labelInset: 8,
};

/**
 * Must match `--sidebar-width` in tokens.css. The canvas needs it as a number
 * to work out which slice of the plot is on screen, so it is applied from here
 * rather than from CSS - that way the two cannot drift apart.
 */
export const SIDEBAR_WIDTH = 264;

/*
 * Zoom limits, in pixels per day.
 *
 * The lower bound is what decides how much history fits on one screen: at
 * 0.0015 a full century is about 55px, so even a multi-century timeline can be
 * taken in at a glance. The upper bound leaves a single day comfortably wide.
 */
export const MIN_UNITS_PER_DAY = 0.0015;
export const MAX_UNITS_PER_DAY = 60;

export const clampZoom = (value: number): number =>
  Math.min(MAX_UNITS_PER_DAY, Math.max(MIN_UNITS_PER_DAY, value));

/** The scale at which the whole timeline just fits the given width. */
export function fitUnitsPerDay(doc: TimelineDoc, availableWidth: number): number {
  const days = Math.max(1, inclusiveDays(doc.settings.start, doc.settings.end));
  return clampZoom((availableWidth - 24) / days);
}

/* ------------------------------------------------------- horizontal axis -- */

/** Distance from the timeline's first day to `date`. */
export function xOf(date: IsoDate, start: IsoDate, unitsPerDay: number): number {
  return daysBetween(start, date) * unitsPerDay;
}

/**
 * Width of an inclusive date range, so a one-day bar is one day wide rather
 * than zero. This is the difference between a milestone you can see and one you
 * cannot.
 */
export function widthOf(from: IsoDate, to: IsoDate, unitsPerDay: number): number {
  return inclusiveDays(from, to) * unitsPerDay;
}

/** Inverse of `xOf` - which day a horizontal position lands on. */
export function dateAtX(x: number, start: IsoDate, unitsPerDay: number): IsoDate {
  return addDays(start, Math.floor(x / unitsPerDay));
}

/** Total width of the whole timeline. */
export function totalWidth(doc: TimelineDoc, unitsPerDay: number): number {
  return widthOf(doc.settings.start, doc.settings.end, unitsPerDay);
}

/* ---------------------------------------------------------------- ticks -- */

export interface Tick {
  date: IsoDate;
  /** Position of the tick's leading edge. */
  x: number;
  /** Width of the span this tick labels, for centring the label. */
  width: number;
  label: string;
}

export interface Axis {
  /** Coarse tier - years above months, months above days. */
  upper: Tick[];
  /** Fine tier, matching the document's granularity. */
  lower: Tick[];
  /** Positions where a major gridline is drawn (upper-tier boundaries). */
  majorLines: number[];
  /** Shaded Saturday/Sunday spans; empty unless days are wide enough to see. */
  weekendBands: { x: number; width: number }[];
  /** Which units the two tiers ended up drawing, after zoom-based coarsening. */
  units: { lower: TickUnit; upper: TickUnit };
}

/** Everything the axis can tick in, from finest to coarsest. */
export type TickUnit = Granularity | "decade" | "century";

type Stepper = {
  floor: (d: IsoDate) => IsoDate;
  next: (d: IsoDate) => IsoDate;
  /** Inclusive last day of the span starting at `d`. */
  endOf: (d: IsoDate) => IsoDate;
  label: (d: IsoDate) => string;
  /** Approximate length, used to decide when a unit is too small to draw. */
  approxDays: number;
  /**
   * Narrowest this unit may be drawn, in screen pixels. It tracks the width of
   * the unit's own label - "15" needs far less room than "1990s" - so a single
   * global threshold would either hide day numbers that fit or crowd year
   * labels that do not.
   */
  minSize: number;
};

const STEPPERS: Record<TickUnit, Stepper> = {
  day: {
    floor: (d) => d,
    next: (d) => addDays(d, 1),
    endOf: (d) => d,
    label: (d) => String(Number(d.slice(8, 10))),
    approxDays: 1,
    minSize: 18,
  },
  week: {
    floor: startOfWeek,
    next: (d) => addDays(d, 7),
    endOf: (d) => addDays(d, 6),
    label: (d) => `W${isoWeekNumber(d)}`,
    approxDays: 7,
    minSize: 20,
  },
  month: {
    floor: startOfMonth,
    next: (d) => addMonths(d, 1),
    endOf: endOfMonth,
    label: (d) => formatMonth(d),
    approxDays: 30.44,
    minSize: 34,
  },
  quarter: {
    floor: startOfQuarter,
    next: (d) => addMonths(d, 3),
    endOf: endOfQuarter,
    label: (d) => `Q${quarterOf(d)}`,
    approxDays: 91.31,
    minSize: 28,
  },
  year: {
    floor: startOfYear,
    next: (d) => addYears(d, 1),
    endOf: endOfYear,
    label: (d) => d.slice(0, 4),
    approxDays: 365.25,
    minSize: 38,
  },
  decade: {
    floor: (d) => `${String(Math.floor(Number(d.slice(0, 4)) / 10) * 10).padStart(4, "0")}-01-01`,
    next: (d) => addYears(d, 10),
    endOf: (d) => endOfYear(addYears(d, 9)),
    label: (d) => `${d.slice(0, 4)}s`,
    approxDays: 3652.5,
    minSize: 46,
  },
  century: {
    floor: (d) => `${String(Math.floor(Number(d.slice(0, 4)) / 100) * 100).padStart(4, "0")}-01-01`,
    next: (d) => addYears(d, 100),
    endOf: (d) => endOfYear(addYears(d, 99)),
    // "1900s" would read as a decade, so centuries are named the way people say
    // them: 1900-1999 is the 20th century.
    label: (d) => `${Math.floor(Number(d.slice(0, 4)) / 100) + 1}th c.`,
    approxDays: 36_525,
    minSize: 52,
  },
};

/** Finest to coarsest. Coarsening walks up this list. */
const UNIT_ORDER: TickUnit[] = ["day", "week", "month", "quarter", "year", "decade", "century"];

/**
 * The unit actually drawn, given how far out the view is zoomed.
 *
 * The document's granularity is the *finest* unit the user wants to see, not a
 * promise to draw it at any scale: at one pixel per year, day ticks would be
 * tens of thousands of invisible gridlines. Coarsening until a tick is wide
 * enough to be worth drawing is what keeps a century-long timeline responsive,
 * and it is why the axis stays readable at every zoom level.
 */
export function effectiveUnits(
  granularity: Granularity,
  unitsPerDay: number,
  /**
   * Scales every unit's minimum width. Screen pixels use 1; the PDF exporter
   * passes a smaller factor because it measures in millimetres.
   */
  sizeScale = 1,
): { lower: TickUnit; upper: TickUnit } {
  const startIndex = UNIT_ORDER.indexOf(granularity);
  // The lower tier is capped below century so the upper tier always has a
  // coarser unit available to sit above it.
  const maxLower = UNIT_ORDER.length - 2;

  let lowerIndex = startIndex;
  while (lowerIndex < maxLower) {
    const stepper = STEPPERS[UNIT_ORDER[lowerIndex]!]!;
    if (stepper.approxDays * unitsPerDay >= stepper.minSize * sizeScale) break;
    lowerIndex += 1;
  }

  // The upper tier is the next unit that is meaningfully coarser. Month over
  // day reads well; quarter over month does not, so skip to year.
  const preferredUpper: Record<TickUnit, TickUnit> = {
    day: "month",
    week: "month",
    month: "year",
    quarter: "year",
    year: "decade",
    decade: "century",
    century: "century",
  };

  return { lower: UNIT_ORDER[lowerIndex]!, upper: preferredUpper[UNIT_ORDER[lowerIndex]!] };
}

/** The slice of the plot to build ticks for, in plot units from the left edge. */
export interface AxisWindow {
  fromX: number;
  toX: number;
}

function buildTier(
  stepper: Stepper,
  timelineStart: IsoDate,
  timelineEnd: IsoDate,
  visibleFrom: IsoDate,
  visibleTo: IsoDate,
  unitsPerDay: number,
): Tick[] {
  const ticks: Tick[] = [];
  let cursor = stepper.floor(visibleFrom);

  // Bounded by the window, so this loop runs a few hundred times at most. The
  // guard only exists to contain a malformed stepper.
  let guard = 0;
  while (cursor <= visibleTo && guard++ < 5_000) {
    const spanEnd = stepper.endOf(cursor);
    // Clip to the timeline so the first and last labels stay centred over the
    // part that is actually drawn.
    const clippedStart = cursor < timelineStart ? timelineStart : cursor;
    const clippedEnd = spanEnd > timelineEnd ? timelineEnd : spanEnd;
    if (clippedEnd >= clippedStart) {
      ticks.push({
        date: cursor,
        x: xOf(clippedStart, timelineStart, unitsPerDay),
        width: widthOf(clippedStart, clippedEnd, unitsPerDay),
        label: stepper.label(cursor),
      });
    }
    const next = stepper.next(cursor);
    if (next <= cursor) break; // Refuse to spin if a stepper fails to advance.
    cursor = next;
  }
  return ticks;
}

/**
 * Builds the axis for a window of the plot.
 *
 * Passing no window builds the whole thing, which is what the PDF exporter
 * wants. The on-screen canvas passes the scrolled viewport, so the cost of
 * drawing the axis depends on the size of the screen rather than on the length
 * of the timeline.
 */
export function buildAxis(
  doc: TimelineDoc,
  unitsPerDay: number,
  window?: AxisWindow,
  sizeScale = 1,
): Axis {
  const { start, end, granularity, showWeekends } = doc.settings;
  const width = totalWidth(doc, unitsPerDay);

  const fromX = Math.max(0, window ? window.fromX : 0);
  const toX = Math.min(width, window ? window.toX : width);

  const visibleFrom = clampDate(dateAtX(fromX, start, unitsPerDay), start, end);
  const visibleTo = clampDate(dateAtX(toX, start, unitsPerDay), start, end);

  const units = effectiveUnits(granularity, unitsPerDay, sizeScale);
  const lower = buildTier(STEPPERS[units.lower], start, end, visibleFrom, visibleTo, unitsPerDay);
  const upper = buildTier(STEPPERS[units.upper], start, end, visibleFrom, visibleTo, unitsPerDay);

  /*
   * Weekend shading is only drawn when a single day is wide enough to see. At
   * anything coarser it is a smear of noise - and on a century-long timeline it
   * would be tens of thousands of bands.
   */
  const weekendBands: Axis["weekendBands"] = [];
  if (showWeekends && unitsPerDay >= 3) {
    let cursor = visibleFrom;
    let guard = 0;
    while (cursor <= visibleTo && guard++ < 5_000) {
      if (isWeekend(cursor)) {
        weekendBands.push({ x: xOf(cursor, start, unitsPerDay), width: unitsPerDay });
      }
      cursor = addDays(cursor, 1);
    }
  }

  return {
    upper,
    lower,
    majorLines: upper.map((tick) => tick.x).filter((x) => x > 0),
    weekendBands,
    units,
  };
}

/* --------------------------------------------------------- vertical plan -- */

/** Where an item's title is drawn relative to its bar. */
export type LabelSide = "inside" | "right" | "left";

export interface PlacedItem {
  item: Item;
  x: number;
  width: number;
  y: number;
  height: number;
  /** Which sub-line inside the lane this item was packed onto. */
  stack: number;
  /** Decided by the packer, so screen and PDF agree on where the title goes. */
  labelSide: LabelSide;
  /** Estimated width of the title when drawn outside the bar. */
  labelWidth: number;
}

export interface PlacedLane {
  rowId: string;
  title: string;
  groupId: string | null;
  /** Palette slot tinting the lane, if one was chosen. */
  color: number | undefined;
  y: number;
  height: number;
  items: PlacedItem[];
}

export interface PlacedGroup {
  groupId: string;
  title: string;
  collapsed: boolean;
  y: number;
  height: number;
  /** Number of lanes inside, shown on the header when collapsed. */
  laneCount: number;
}

export interface Layout {
  lanes: PlacedLane[];
  groups: PlacedGroup[];
  totalHeight: number;
  totalWidth: number;
  options: LayoutOptions;
}

/**
 * Rough width of a string, without touching the DOM.
 *
 * Measuring properly would mean a canvas context on screen and font metrics in
 * the exporter - two different answers for the same layout, which is exactly
 * what this module exists to prevent. An average advance is close enough to
 * decide whether a title fits, and both renderers then trim to their own real
 * metrics.
 */
export function estimateLabelWidth(text: string, charWidth: number): number {
  return text.length * charWidth;
}

interface Packed {
  stack: number;
  labelSide: LabelSide;
  labelWidth: number;
}

/**
 * Packs a lane's items onto sub-lines, taking their titles into account.
 *
 * A title too long for its bar is drawn beside it, and that text takes up room
 * exactly as the bar does. Ignoring it is what lets a label sit on top of the
 * next card. So each item claims an interval covering its bar *and* its label,
 * and an item that cannot claim one on a line drops to the next - the same rule
 * that already separated overlapping bars, extended to the text.
 *
 * The label goes right by default and left when the right would run past the
 * end of the timeline or collide with the following item. Items must be sorted
 * by start date, which the caller guarantees.
 */
function packLane(
  items: Item[],
  options: LayoutOptions,
  timelineStart: IsoDate,
  timelineWidth: number,
): Map<string, Packed> {
  const { unitsPerDay, labelGap, minItemGap, labelInset, labelCharWidth, cardHeight } = options;

  /** Rightmost point claimed on each sub-line so far. */
  const claimed: number[] = [];
  const result = new Map<string, Packed>();

  items.forEach((item, index) => {
    const x = xOf(item.start, timelineStart, unitsPerDay);
    // A milestone is a point in the model but a diamond on screen, so it claims
    // the diamond's width - otherwise two milestones a day apart overlap at any
    // zoom below one pixel per day.
    const barWidth =
      item.kind === "milestone"
        ? cardHeight * 0.62
        : widthOf(item.start, item.end, unitsPerDay);

    const textWidth = estimateLabelWidth(item.title, labelCharWidth);
    const fitsInside = item.kind !== "milestone" && textWidth + labelInset * 2 <= barWidth;
    const labelWidth = fitsInside ? 0 : textWidth + labelGap;

    let preferLeft = false;
    if (!fitsInside) {
      // No room on the right if the label would run off the end of the plot...
      const overflowsEnd = x + barWidth + labelWidth > timelineWidth;
      // ...or if the next item would sit underneath it.
      const next = items[index + 1];
      const collidesWithNext =
        next !== undefined &&
        xOf(next.start, timelineStart, unitsPerDay) < x + barWidth + labelWidth + minItemGap;
      preferLeft = overflowsEnd || collidesWithNext;
    }

    const place = (line: number, side: LabelSide): boolean => {
      const leftEdge = side === "left" ? x - labelWidth : x;
      const rightEdge = side === "right" ? x + barWidth + labelWidth : x + barWidth;
      const free = leftEdge >= (claimed[line] ?? -Infinity) + minItemGap;
      if (!free) return false;
      claimed[line] = rightEdge;
      result.set(item.id, { stack: line, labelSide: side, labelWidth });
      return true;
    };

    const sides: LabelSide[] = fitsInside
      ? ["inside"]
      : preferLeft
        ? ["left", "right"]
        : ["right", "left"];

    for (let line = 0; line < claimed.length; line++) {
      if (sides.some((side) => place(line, side))) return;
    }

    // Nothing fitted, so open a new sub-line. A left label there would hang
    // over empty space to the left, which reads worse than one on the right.
    const line = claimed.length;
    claimed.push(-Infinity);
    place(line, fitsInside ? "inside" : preferLeft && x - labelWidth >= 0 ? "left" : "right");
  });

  return result;
}

/**
 * Full vertical plan: group headers, lanes, and every item's box. Rows inside a
 * collapsed group are omitted entirely rather than rendered at zero height, so
 * downstream code never has to filter them again.
 */
export function layout(doc: TimelineDoc, options: LayoutOptions = DEFAULT_LAYOUT): Layout {
  const { unitsPerDay, cardHeight, cardGap, lanePadding, groupHeaderHeight, groupGap } = options;
  const timelineStart = doc.settings.start;

  const itemsByRow = new Map<string, Item[]>();
  for (const item of doc.items) {
    const bucket = itemsByRow.get(item.rowId);
    if (bucket) bucket.push(item);
    else itemsByRow.set(item.rowId, [item]);
  }
  for (const bucket of itemsByRow.values()) {
    bucket.sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));
  }

  const lanes: PlacedLane[] = [];
  const groups: PlacedGroup[] = [];
  let y = 0;

  const plotWidth = totalWidth(doc, unitsPerDay);

  const emitLane = (row: {
    id: string;
    title: string;
    groupId: string | null;
    color?: number;
  }): void => {
    const items = itemsByRow.get(row.id) ?? [];
    const packed = packLane(items, options, timelineStart, plotWidth);
    const stackCount = Math.max(1, ...[...packed.values()].map((entry) => entry.stack + 1));
    const height = lanePadding * 2 + stackCount * cardHeight + (stackCount - 1) * cardGap;

    lanes.push({
      rowId: row.id,
      title: row.title,
      groupId: row.groupId,
      color: row.color,
      y,
      height,
      items: items.map((item) => {
        const entry = packed.get(item.id) ?? { stack: 0, labelSide: "inside" as const, labelWidth: 0 };
        return {
          item,
          x: xOf(item.start, timelineStart, unitsPerDay),
          width: widthOf(item.start, item.end, unitsPerDay),
          y: y + lanePadding + entry.stack * (cardHeight + cardGap),
          height: cardHeight,
          stack: entry.stack,
          labelSide: entry.labelSide,
          labelWidth: entry.labelWidth,
        };
      }),
    });
    y += height;
  };

  // Ungrouped rows render first, in document order, above every group.
  for (const row of doc.rows) {
    if (row.groupId === null) emitLane(row);
  }

  for (const group of doc.groups) {
    const groupTop = y;
    const members = doc.rows.filter((row) => row.groupId === group.id);

    y += groupHeaderHeight;
    if (!group.collapsed) {
      for (const row of members) emitLane(row);
    }

    groups.push({
      groupId: group.id,
      title: group.title,
      collapsed: group.collapsed,
      y: groupTop,
      height: y - groupTop,
      laneCount: members.length,
    });
    y += groupGap;
  }

  return {
    lanes,
    groups,
    totalHeight: Math.max(0, y),
    totalWidth: totalWidth(doc, unitsPerDay),
    options,
  };
}

/** Looks up a placed item by id without re-walking the whole layout. */
export function findPlacedItem(layoutResult: Layout, itemId: string): PlacedItem | undefined {
  for (const lane of layoutResult.lanes) {
    const found = lane.items.find((placed) => placed.item.id === itemId);
    if (found) return found;
  }
  return undefined;
}

/** Which lane a vertical position falls in - used while dragging a card. */
export function laneAtY(layoutResult: Layout, y: number): PlacedLane | undefined {
  return layoutResult.lanes.find((lane) => y >= lane.y && y < lane.y + lane.height);
}

/*
 * A dragged card must land on whole units of its own precision: dragging a
 * month-precision bar should move it a month at a time, not to an arbitrary day
 * inside one. Snapping the *start* and preserving the duration keeps the bar
 * the same length, which is what a user dragging it expects.
 */
export function snapDrag(
  item: Item,
  deltaDays: number,
  precision: Precision,
): { start: IsoDate; end: IsoDate } {
  const duration = daysBetween(item.start, item.end);

  if (precision === "day") {
    const start = addDays(item.start, deltaDays);
    return { start, end: addDays(start, duration) };
  }

  const step = precision === "month" ? addMonths : addYears;
  const unitDays = precision === "month" ? 30.44 : 365.25;
  const units = Math.round(deltaDays / unitDays);
  const start = step(item.start, units);
  // Re-derive the end from the snapped start so a month-precision bar always
  // covers whole months, even after repeated drags.
  const end = precision === "month" ? endOfMonth(step(start, Math.round(duration / unitDays))) : endOfYear(step(start, Math.round(duration / unitDays)));
  return { start, end: end < start ? start : end };
}

/* --------------------------------------------------------------- snapping -- */

/**
 * Dates a dragged card can latch onto: every other card's start and the day
 * after its end, plus today and the ends of the timeline.
 *
 * "The day after its end" rather than its end, because ranges here are
 * inclusive - a card ending on the 5th and one starting on the 6th are flush,
 * and that is what butting two cards together should produce.
 */
export function collectSnapTargets(doc: TimelineDoc, excludeItemId?: string): IsoDate[] {
  const targets = new Set<IsoDate>([doc.settings.start, addDays(doc.settings.end, 1)]);

  for (const item of doc.items) {
    if (item.id === excludeItemId) continue;
    targets.add(item.start);
    targets.add(addDays(item.end, 1));
  }
  if (doc.settings.showToday) targets.add(todayIso());

  return [...targets];
}

export interface SnapResult {
  /** Shift in whole days, or 0 when nothing was close enough. */
  days: number;
  /** The date that was latched onto, so the editor can show where it snapped. */
  target: IsoDate | null;
}

/**
 * How far to nudge a dragged item so one of its edges lands on a target.
 *
 * The threshold is in screen units, so snapping feels the same at every zoom
 * rather than covering months when zoomed out. The matched target comes back
 * with it: a snap that moves an edge without saying what it caught on looks
 * like the editor guessing.
 */
export function snapOffsetDays(
  edges: IsoDate[],
  targets: IsoDate[],
  unitsPerDay: number,
  thresholdPx = 9,
): SnapResult {
  let best: SnapResult = { days: 0, target: null };
  let bestDistance = Infinity;

  for (const edge of edges) {
    for (const target of targets) {
      const days = daysBetween(edge, target);
      const distance = Math.abs(days * unitsPerDay);
      if (distance <= thresholdPx && distance < bestDistance) {
        bestDistance = distance;
        best = { days, target };
      }
    }
  }
  return best;
}

/** Clamps an item to the timeline window, keeping its length where possible. */
export function clampToWindow(
  start: IsoDate,
  end: IsoDate,
  windowStart: IsoDate,
  windowEnd: IsoDate,
): { start: IsoDate; end: IsoDate } {
  const span = daysBetween(start, end);
  let nextStart = start;
  if (nextStart < windowStart) nextStart = windowStart;
  let nextEnd = addDays(nextStart, span);
  if (nextEnd > windowEnd) {
    nextEnd = windowEnd;
    const shifted = addDays(nextEnd, -span);
    nextStart = shifted < windowStart ? windowStart : shifted;
  }
  return { start: nextStart, end: nextEnd };
}

/** Where the "today" marker sits, or null when it is outside the window. */
export function todayX(doc: TimelineDoc, unitsPerDay: number, todayIso: IsoDate): number | null {
  if (todayIso < doc.settings.start || todayIso > doc.settings.end) return null;
  return xOf(todayIso, doc.settings.start, unitsPerDay);
}

/** Re-exported so the exporter does not need its own date import. */
export { toIso, toTime };
