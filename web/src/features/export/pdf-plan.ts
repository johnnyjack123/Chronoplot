/*
 * Page planning for the PDF export.
 *
 * Deliberately free of any jsPDF import: the export dialog needs a live page
 * count on every option change, and pulling the PDF library (plus the
 * html2canvas and DOMPurify it drags along) into the editor bundle to compute
 * an integer would be absurd. The renderer is loaded only when someone actually
 * exports.
 */
import type { ThemeName, TimelineDoc } from "@shared";
import { inclusiveDays } from "@/lib/dates";
import { buildAxis, laneColumnWidth, layout as computeLayout } from "@/features/timeline/geometry";

export type PageSize = "a4" | "a3" | "letter";
export type Orientation = "portrait" | "landscape";

export interface ExportOptions {
  pageSize: PageSize;
  orientation: Orientation;
  /** Millimetres per day. `null` means "fit the whole timeline to one page width". */
  mmPerDay: number | null;
  /**
   * Multiplier on every vertical measurement - lane heights, bar heights, the
   * gaps between them.
   *
   * The scale presets only ever changed the horizontal scale, which is why a
   * "detailed" export spread across more pages sideways but stayed exactly as
   * cramped top to bottom. Text size is left alone: this makes rows roomier,
   * not the type bigger.
   */
  verticalScale: number;
  /** Theme whose colours the PDF is drawn in. */
  theme: ThemeName;
  title: string;
  /** Draws lane names down the left edge of every page. */
  repeatLaneLabels: boolean;
  showToday: boolean;
}

export const PAGE_SIZES: Record<PageSize, { width: number; height: number; label: string }> = {
  a4: { width: 210, height: 297, label: "A4" },
  a3: { width: 297, height: 420, label: "A3" },
  letter: { width: 215.9, height: 279.4, label: "Letter" },
};

export const MARGIN = 12;
export const AXIS_HEIGHT = 11;
export const FOOTER_HEIGHT = 7;

/**
 * Metrics for the lane-name column, in millimetres.
 *
 * Lane names print at 7pt Helvetica, group headings at 7pt bold uppercase -
 * which is why they get their own, wider, per-glyph figure. The ceiling stops a
 * single very long name from swallowing the page; only past that does anything
 * get trimmed.
 */
export const LANE_COLUMN = {
  charWidth: 1.45,
  groupCharWidth: 1.75,
  indent: 2,
  padding: 5,
  min: 22,
  /** Fraction of the usable page width the column may take at most. */
  maxFraction: 0.45,
};

/** Width of the lane-name column for this document, on this page. */
export function laneLabelWidth(doc: TimelineDoc, options: ExportOptions): number {
  if (!options.repeatLaneLabels) return 0;
  const box = pageBox(options);
  return laneColumnWidth(doc, {
    ...LANE_COLUMN,
    max: (box.width - MARGIN * 2) * LANE_COLUMN.maxFraction,
  });
}

/**
 * Scales the axis coarsening thresholds for print. The page is measured in
 * millimetres, so a tick that needs 34px on screen needs roughly a tenth of
 * that in mm - the same rule, in the units of the page.
 */
export const PRINT_TICK_SCALE = 0.3;

/** Millimetre layout constants, the print counterparts of the screen ones. */
export const PRINT_LAYOUT = {
  cardHeight: 6,
  cardGap: 1.6,
  lanePadding: 1.6,
  groupHeaderHeight: 6,
  groupGap: 3,
  // Helvetica at 6.5pt averages roughly 1.5mm per glyph.
  labelCharWidth: 1.5,
  labelGap: 1.6,
  minItemGap: 1.2,
  labelInset: 1.5,
};

/** PRINT_LAYOUT with every vertical measurement scaled. */
export function printLayout(verticalScale: number) {
  const scale = Math.min(4, Math.max(0.4, verticalScale || 1));
  return {
    ...PRINT_LAYOUT,
    cardHeight: PRINT_LAYOUT.cardHeight * scale,
    cardGap: PRINT_LAYOUT.cardGap * scale,
    lanePadding: PRINT_LAYOUT.lanePadding * scale,
    groupHeaderHeight: PRINT_LAYOUT.groupHeaderHeight * scale,
    groupGap: PRINT_LAYOUT.groupGap * scale,
  };
}

export function pageBox(options: ExportOptions): { width: number; height: number } {
  const page = PAGE_SIZES[options.pageSize];
  return options.orientation === "landscape"
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

export interface PagePlan {
  /** Horizontal slices, in plot millimetres. */
  columns: { startX: number; endX: number }[];
  /** Vertical slices, each a run of lanes that fits one page. */
  rows: { startY: number; endY: number }[];
  totalPages: number;
  mmPerDay: number;
  plotWidth: number;
  plotHeight: number;
  /** Width the renderer must use for the lane column, so both agree. */
  labelWidth: number;
}

/**
 * Works out where the pages break.
 *
 * Horizontal breaks prefer a calendar boundary - a year, month or tick edge -
 * so a page starts at something a reader recognises rather than mid-March. A
 * boundary is only taken when it is within the last third of the page, so
 * snapping never wastes half a sheet.
 *
 * Vertical breaks never split a lane: half a bar at the bottom of a page is
 * worse than a page that ends early.
 */
export function planPages(doc: TimelineDoc, options: ExportOptions): PagePlan {
  const box = pageBox(options);
  const labelWidth = laneLabelWidth(doc, options);
  const availableWidth = box.width - MARGIN * 2 - labelWidth;
  const availableHeight = box.height - MARGIN * 2 - AXIS_HEIGHT - FOOTER_HEIGHT;

  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error("The page is too small for these margins.");
  }

  const totalDays = Math.max(1, inclusiveDays(doc.settings.start, doc.settings.end));
  const mmPerDay = options.mmPerDay ?? availableWidth / totalDays;

  const built = computeLayout(doc, { ...printLayout(options.verticalScale), unitsPerDay: mmPerDay });
  const axis = buildAxis(doc, mmPerDay, undefined, PRINT_TICK_SCALE);

  /* ---------------------------------------------------- horizontal slices -- */
  const columns: PagePlan["columns"] = [];
  const boundaries = [...axis.majorLines, ...axis.lower.map((tick) => tick.x)].sort((a, b) => a - b);

  let cursor = 0;
  let guard = 0;
  while (cursor < built.totalWidth - 0.01 && guard++ < 2000) {
    const hardEnd = cursor + availableWidth;
    if (hardEnd >= built.totalWidth) {
      columns.push({ startX: cursor, endX: built.totalWidth });
      break;
    }
    const snapped = boundaries
      .filter((x) => x > cursor + availableWidth * 0.66 && x <= hardEnd)
      .pop();
    const end = snapped ?? hardEnd;
    columns.push({ startX: cursor, endX: end });
    cursor = end;
  }
  if (columns.length === 0) columns.push({ startX: 0, endX: Math.max(built.totalWidth, 1) });

  /* ------------------------------------------------------ vertical slices -- */
  const rows: PagePlan["rows"] = [];
  const stops = [
    ...built.lanes.map((lane) => lane.y + lane.height),
    ...built.groups.map((group) => group.y + group.height),
  ].sort((a, b) => a - b);

  let top = 0;
  let verticalGuard = 0;
  while (top < built.totalHeight - 0.01 && verticalGuard++ < 2000) {
    const limit = top + availableHeight;
    if (limit >= built.totalHeight) {
      rows.push({ startY: top, endY: built.totalHeight });
      break;
    }
    // A lane taller than a whole page still has to be emitted, so fall back to
    // a hard cut rather than looping forever on a stop that never fits.
    const stop = stops.filter((y) => y > top && y <= limit).pop();
    rows.push({ startY: top, endY: stop ?? limit });
    top = stop ?? limit;
  }
  if (rows.length === 0) rows.push({ startY: 0, endY: Math.max(built.totalHeight, 1) });

  return {
    columns,
    rows,
    totalPages: columns.length * rows.length,
    mmPerDay,
    plotWidth: built.totalWidth,
    plotHeight: built.totalHeight,
    labelWidth,
  };
}
