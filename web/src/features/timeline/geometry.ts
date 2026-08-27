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
  addDays, addMonths, addYears, daysBetween, endOfMonth, endOfQuarter, endOfYear,
  formatMonth, inclusiveDays, isoWeekNumber, isWeekend, quarterOf, startOfMonth,
  startOfQuarter, startOfWeek, startOfYear, toIso, toTime, type IsoDate,
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
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  unitsPerDay: 3,
  cardHeight: 32,
  cardGap: 6,
  lanePadding: 6,
  groupHeaderHeight: 28,
  groupGap: 12,
};

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
  /** Shaded Saturday/Sunday spans; empty unless enabled at day granularity. */
  weekendBands: { x: number; width: number }[];
}

type Stepper = {
  floor: (d: IsoDate) => IsoDate;
  next: (d: IsoDate) => IsoDate;
  /** Inclusive last day of the span starting at `d`. */
  endOf: (d: IsoDate) => IsoDate;
  label: (d: IsoDate) => string;
};

const STEPPERS: Record<Granularity | "decade", Stepper> = {
  day: {
    floor: (d) => d,
    next: (d) => addDays(d, 1),
    endOf: (d) => d,
    label: (d) => String(Number(d.slice(8, 10))),
  },
  week: {
    floor: startOfWeek,
    next: (d) => addDays(d, 7),
    endOf: (d) => addDays(d, 6),
    label: (d) => `W${isoWeekNumber(d)}`,
  },
  month: {
    floor: startOfMonth,
    next: (d) => addMonths(d, 1),
    endOf: endOfMonth,
    label: (d) => formatMonth(d),
  },
  quarter: {
    floor: startOfQuarter,
    next: (d) => addMonths(d, 3),
    endOf: endOfQuarter,
    label: (d) => `Q${quarterOf(d)}`,
  },
  year: {
    floor: startOfYear,
    next: (d) => addYears(d, 1),
    endOf: endOfYear,
    label: (d) => d.slice(0, 4),
  },
  decade: {
    floor: (d) => `${String(Math.floor(Number(d.slice(0, 4)) / 10) * 10).padStart(4, "0")}-01-01`,
    next: (d) => addYears(d, 10),
    endOf: (d) => endOfYear(addYears(d, 9)),
    label: (d) => `${d.slice(0, 4)}s`,
  },
};

/** Which coarse unit sits above each fine unit in the two-tier header. */
const UPPER_TIER: Record<Granularity, Granularity | "decade"> = {
  day: "month",
  week: "month",
  month: "year",
  quarter: "year",
  year: "decade",
};

function buildTier(
  stepper: Stepper,
  start: IsoDate,
  end: IsoDate,
  unitsPerDay: number,
): Tick[] {
  const ticks: Tick[] = [];
  let cursor = stepper.floor(start);

  // Guard against a malformed stepper turning this into an infinite loop.
  let guard = 0;
  while (cursor <= end && guard++ < 20_000) {
    const spanEnd = stepper.endOf(cursor);
    // Clip the first and last spans to the visible window so their labels stay
    // centred over the part that is actually drawn.
    const visibleStart = cursor < start ? start : cursor;
    const visibleEnd = spanEnd > end ? end : spanEnd;
    ticks.push({
      date: cursor,
      x: xOf(visibleStart, start, unitsPerDay),
      width: widthOf(visibleStart, visibleEnd, unitsPerDay),
      label: stepper.label(cursor),
    });
    cursor = stepper.next(cursor);
  }
  return ticks;
}

export function buildAxis(doc: TimelineDoc, unitsPerDay: number): Axis {
  const { start, end, granularity, showWeekends } = doc.settings;

  const lower = buildTier(STEPPERS[granularity], start, end, unitsPerDay);
  const upper = buildTier(STEPPERS[UPPER_TIER[granularity]], start, end, unitsPerDay);

  const weekendBands: Axis["weekendBands"] = [];
  // Only meaningful when individual days are distinguishable; at month scale a
  // weekend band is a two-pixel smear that just adds noise.
  if (showWeekends && granularity === "day") {
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
      if (isWeekend(cursor)) {
        weekendBands.push({ x: xOf(cursor, start, unitsPerDay), width: unitsPerDay });
      }
    }
  }

  return {
    upper,
    lower,
    majorLines: upper.map((tick) => tick.x).filter((x) => x > 0),
    weekendBands,
  };
}

/* --------------------------------------------------------- vertical plan -- */

export interface PlacedItem {
  item: Item;
  x: number;
  width: number;
  y: number;
  height: number;
  /** Which sub-line inside the lane this item was packed onto. */
  stack: number;
}

export interface PlacedLane {
  rowId: string;
  title: string;
  groupId: string | null;
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
 * Greedy interval partitioning: each item goes on the first sub-line whose last
 * item has already ended. Overlapping bars therefore stack instead of hiding
 * each other, and a lane grows only as tall as it needs to be.
 *
 * Items must be sorted by start date for this to be optimal, which is why the
 * caller sorts first.
 */
function packStacks(items: Item[]): Map<string, number> {
  const lastEnd: number[] = [];
  const assignment = new Map<string, number>();

  for (const item of items) {
    const startTime = toTime(item.start);
    let placed = false;
    for (let line = 0; line < lastEnd.length; line++) {
      // A bar ending on the 5th and one starting on the 5th would visually
      // touch, so require a clear day between them.
      if ((lastEnd[line] ?? -Infinity) < startTime) {
        assignment.set(item.id, line);
        lastEnd[line] = toTime(item.end);
        placed = true;
        break;
      }
    }
    if (!placed) {
      assignment.set(item.id, lastEnd.length);
      lastEnd.push(toTime(item.end));
    }
  }
  return assignment;
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

  const emitLane = (row: { id: string; title: string; groupId: string | null }): void => {
    const items = itemsByRow.get(row.id) ?? [];
    const stacks = packStacks(items);
    const stackCount = Math.max(1, ...[...stacks.values()].map((n) => n + 1));
    const height = lanePadding * 2 + stackCount * cardHeight + (stackCount - 1) * cardGap;

    lanes.push({
      rowId: row.id,
      title: row.title,
      groupId: row.groupId,
      y,
      height,
      items: items.map((item) => {
        const stack = stacks.get(item.id) ?? 0;
        return {
          item,
          x: xOf(item.start, timelineStart, unitsPerDay),
          width: widthOf(item.start, item.end, unitsPerDay),
          y: y + lanePadding + stack * (cardHeight + cardGap),
          height: cardHeight,
          stack,
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
