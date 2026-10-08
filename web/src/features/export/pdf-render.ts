/*
 * PDF rendering.
 *
 * The timeline is *drawn* as vector shapes and real text, not captured as an
 * image. That is what keeps the output crisp at any zoom, keeps the text
 * selectable and searchable, and lets the exporter place page breaks exactly.
 *
 * Geometry comes from the same module the screen uses, with millimetres
 * substituted for pixels, so the export cannot drift from what was arranged.
 *
 * This module is loaded on demand - see pdf-plan.ts for why.
 */
import type { jsPDF as JsPdfType } from "jspdf";
import type { ThemeName, TimelineDoc } from "@shared";
import { formatDate, today } from "@/lib/dates";
import { buildAxis, layout as computeLayout, xOf } from "@/features/timeline/geometry";
import {
  LANE_TINT_STRENGTH, resolveCardHex, resolveCardInkHex, resolveToken,
} from "@/features/timeline/colors";
import {
  AXIS_HEIGHT, MARGIN, PRINT_TICK_SCALE, pageBox, planPages, printLayout,
  type ExportOptions,
} from "./pdf-plan";

/*
 * Colour conversion.
 *
 * Theme tokens are CSS colours, and several of them carry alpha - gridlines and
 * borders are deliberately translucent so they sit on any surface. jsPDF only
 * understands opaque colours, so every token is flattened against the surface
 * it will be drawn on before it reaches the PDF.
 */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(css: string): Rgba | null {
  const value = css.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const digits = hex[1];
    const full = digits.length === 3 ? digits.split("").map((d) => d + d).join("") : digits;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }

  // Handles both the legacy `rgb(r, g, b)` form and the modern
  // `rgb(r g b / a)` form the theme file uses.
  const fn = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (fn?.[1]) {
    const [rgbPart, alphaPart] = fn[1].split("/");
    const parts = (rgbPart ?? "").trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const alpha = alphaPart !== undefined ? Number(alphaPart) : parts[3] !== undefined ? Number(parts[3]) : 1;
    return {
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
      a: Number.isFinite(alpha) ? alpha : 1,
    };
  }

  return null;
}

const toHex = (value: number): string =>
  Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");

/** Flattens `color` onto `background`, returning an opaque `#rrggbb`. */
function flatten(color: string, background: Rgba, fallback: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return fallback;
  }
  if (parsed.a >= 1) {
    return `#${toHex(parsed.r)}${toHex(parsed.g)}${toHex(parsed.b)}`;
  }

  const mix = (channel: keyof Omit<Rgba, "a">): number =>
    parsed[channel] * parsed.a + background[channel] * (1 - parsed.a);
  return `#${toHex(mix("r"))}${toHex(mix("g"))}${toHex(mix("b"))}`;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Blends two opaque colours, `amount` being how much of `a` shows through. */
function mix(a: string, b: Rgba, amount: number): string {
  const parsed = parseColor(a);
  if (!parsed) {
    return `#${toHex(b.r)}${toHex(b.g)}${toHex(b.b)}`;
  }
  const channel = (key: "r" | "g" | "b"): number => parsed[key] * amount + b[key] * (1 - amount);
  return `#${toHex(channel("r"))}${toHex(channel("g"))}${toHex(channel("b"))}`;
}

/**
 * Reads theme colours without disturbing the page the user is looking at: a
 * detached element carrying the requested `data-theme` is measured, so the PDF
 * can use a light theme while the editor stays dark.
 */
function readPalette(theme: ThemeName) {
  const probe = document.createElement("div");
  probe.setAttribute("data-theme", theme);
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);

  return {
    token: (name: string, fallback: string) => resolveToken(name, probe) || fallback,
    cardHex: (slot: number) => resolveCardHex(slot, probe),
    cardInkHex: (slot: number) => resolveCardInkHex(slot, probe),
    dispose: () => probe.remove(),
  };
}

/** Trims text with an ellipsis so it never runs past its box. */
function fit(pdf: JsPdfType, text: string, maxWidth: number): string {
  if (maxWidth <= 2) {
    return "";
  }
  if (pdf.getTextWidth(text) <= maxWidth) {
    return text;
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (pdf.getTextWidth(`${text.slice(0, mid)}…`) <= maxWidth) {
      low = mid;
    }
    else {
      high = mid - 1;
    }
  }
  return low > 0 ? `${text.slice(0, low)}…` : "";
}

export async function buildPdf(doc: TimelineDoc, options: ExportOptions): Promise<JsPdfType> {
  const { jsPDF } = await import("jspdf");
  const plan = planPages(doc, options);
  const palette = readPalette(options.theme);

  try {
    const box = pageBox(options);
    const pdf = new jsPDF({
      unit: "mm",
      format: [box.width, box.height],
      orientation: options.orientation,
      compress: true,
    });

    // Taken from the plan so the drawing and the pagination cannot disagree
    // about how much room the lane names need.
    const labelWidth = plan.labelWidth;
    const plotLeft = MARGIN + labelWidth;
    const plotTop = MARGIN + AXIS_HEIGHT;

    const built = computeLayout(doc, {
      ...printLayout(options.verticalScale),
      unitsPerDay: plan.mmPerDay,
    });
    const axis = buildAxis(doc, plan.mmPerDay, undefined, PRINT_TICK_SCALE);

    /*
     * The page is painted in the theme's own canvas colour rather than left
     * white. That is what makes exporting a dark theme produce something you
     * can actually put on a slide, instead of near-invisible pale gridlines on
     * white paper. Light themes come out effectively white, as expected.
     */
    const canvasHex = flatten(palette.token("--canvas", "#ffffff"), WHITE, "#ffffff");
    const pageBackground = parseColor(canvasHex) ?? WHITE;
    const isPaperWhite = pageBackground.r > 246 && pageBackground.g > 246 && pageBackground.b > 246;

    const ink = flatten(palette.token("--ink", "#111111"), pageBackground, "#111111");
    const inkMuted = flatten(palette.token("--ink-muted", "#555555"), pageBackground, "#555555");
    const inkSubtle = flatten(palette.token("--ink-subtle", "#888888"), pageBackground, "#888888");
    const gridMinor = flatten(palette.token("--grid-line", "#eeeeee"), pageBackground, "#eeeeee");
    const gridMajor = flatten(palette.token("--grid-line-strong", "#cccccc"), pageBackground, "#cccccc");
    const accent = flatten(palette.token("--accent", "#3055d8"), pageBackground, "#3055d8");

    // Card colours are solid by design, but flattening them too means a future
    // palette with alpha cannot break the exporter.
    const cardFillHex = (slot: number): string =>
      flatten(palette.cardHex(slot), pageBackground, "#7c8698");
    const cardTextHex = (slot: number): string =>
      flatten(palette.cardInkHex(slot), pageBackground, "#ffffff");

    pdf.setFont("helvetica", "normal");
    let pageIndex = 0;

    for (const rowSlice of plan.rows) {
      for (const column of plan.columns) {
        if (pageIndex > 0) {
          pdf.addPage([box.width, box.height], options.orientation);
        }
        pageIndex += 1;

        const sliceWidth = column.endX - column.startX;
        const sliceHeight = rowSlice.endY - rowSlice.startY;

        if (!isPaperWhite) {
          pdf.setFillColor(canvasHex);
          pdf.rect(0, 0, box.width, box.height, "F");
        }

        /*
         * Lane washes go down before anything else, so the gridlines and cards
         * sit on top of them rather than being painted over.
         */
        for (const lane of built.lanes) {
          if (lane.color === undefined) {
            continue;
          }
          const top = lane.y - rowSlice.startY;
          if (top + lane.height <= 0 || top >= sliceHeight) {
            continue;
          }

          const clippedTop = Math.max(0, top);
          pdf.setFillColor(mix(palette.cardHex(lane.color), pageBackground, LANE_TINT_STRENGTH));
          pdf.rect(
            MARGIN,
            plotTop + clippedTop,
            box.width - MARGIN * 2,
            Math.min(lane.height, sliceHeight - clippedTop),
            "F",
          );
        }

        /* ------------------------------------------------------- heading -- */
        pdf.setTextColor(ink);
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.text(fit(pdf, options.title, box.width - MARGIN * 2 - 40), MARGIN, MARGIN - 3);
        pdf.setFont("helvetica", "normal");

        /* ---------------------------------------------------------- axis -- */
        pdf.setFontSize(7);
        for (const tick of axis.upper) {
          const left = tick.x - column.startX;
          if (left + tick.width <= 0 || left >= sliceWidth) {
            continue;
          }

          const visibleLeft = Math.max(0, left);
          const visibleRight = Math.min(sliceWidth, left + tick.width);
          pdf.setTextColor(inkMuted);
          pdf.text(
            fit(pdf, tick.label, visibleRight - visibleLeft - 1),
            plotLeft + visibleLeft + 1,
            MARGIN + 5,
          );
          if (left > 0) {
            pdf.setDrawColor(gridMajor);
            pdf.setLineWidth(0.35);
            pdf.line(plotLeft + left, MARGIN + 1, plotLeft + left, plotTop + sliceHeight);
          }
        }

        pdf.setFontSize(6);
        for (const tick of axis.lower) {
          const left = tick.x - column.startX;
          if (left + tick.width <= 0 || left >= sliceWidth) {
            continue;
          }

          const visibleLeft = Math.max(0, left);
          const visibleRight = Math.min(sliceWidth, left + tick.width);
          const width = visibleRight - visibleLeft;

          if (width > 4) {
            pdf.setTextColor(inkSubtle);
            pdf.text(fit(pdf, tick.label, width - 0.5), plotLeft + visibleLeft + width / 2, plotTop - 2, {
              align: "center",
            });
          }
          if (left > 0) {
            pdf.setDrawColor(gridMinor);
            pdf.setLineWidth(0.18);
            pdf.line(plotLeft + left, plotTop, plotLeft + left, plotTop + sliceHeight);
          }
        }

        pdf.setDrawColor(gridMajor);
        pdf.setLineWidth(0.4);
        pdf.line(MARGIN, plotTop, box.width - MARGIN, plotTop);

        /*
         * The rule between the lane names and the plot. Without it the two run
         * together and the page reads as one undifferentiated block - the names
         * stop looking like a column and start looking like stray labels.
         */
        if (options.repeatLaneLabels) {
          pdf.setDrawColor(gridMajor);
          pdf.setLineWidth(0.5);
          pdf.line(plotLeft - 2, MARGIN, plotLeft - 2, plotTop + sliceHeight);
        }

        /* ------------------------------------------------ group headings -- */
        for (const group of built.groups) {
          if (group.y < rowSlice.startY || group.y >= rowSlice.endY) {
            continue;
          }
          pdf.setFontSize(7);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(inkMuted);
          pdf.text(
            fit(pdf, group.title.toUpperCase(), Math.max(20, labelWidth) - 2),
            MARGIN + 1,
            plotTop + (group.y - rowSlice.startY) + 4,
          );
          pdf.setFont("helvetica", "normal");
        }

        /* ------------------------------------------------ lanes and cards -- */
        for (const lane of built.lanes) {
          const top = lane.y - rowSlice.startY;
          if (top + lane.height <= 0 || top >= sliceHeight) {
            continue;
          }

          const separatorY = plotTop + top + lane.height;
          if (separatorY <= plotTop + sliceHeight + 0.01) {
            pdf.setDrawColor(gridMinor);
            pdf.setLineWidth(0.15);
            pdf.line(MARGIN, separatorY, box.width - MARGIN, separatorY);
          }

          if (options.repeatLaneLabels) {
            pdf.setFontSize(7);
            pdf.setTextColor(ink);
            pdf.text(
              fit(pdf, lane.title, labelWidth - 3 - (lane.groupId ? 2 : 0)),
              MARGIN + (lane.groupId ? 3 : 1),
              plotTop + top + lane.height / 2 + 1,
            );
          }

          for (const placed of lane.items) {
            const left = placed.x - column.startX;
            const right = left + placed.width;
            if (right <= 0 || left >= sliceWidth) {
              continue;
            }

            const y = plotTop + (placed.y - rowSlice.startY);
            if (y + placed.height <= plotTop || y >= plotTop + sliceHeight) {
              continue;
            }

            pdf.setFillColor(cardFillHex(placed.item.color));

            if (placed.item.kind === "milestone") {
              // Drawn as a filled diamond polygon so it prints as a shape rather
              // than a rotated square with a bounding box.
              const size = placed.height * 0.6;
              const cx = plotLeft + left + size / 2;
              const cy = y + placed.height / 2;
              pdf.lines(
                [
                  [size / 2, size / 2],
                  [-size / 2, size / 2],
                  [-size / 2, -size / 2],
                ],
                cx,
                cy - size / 2,
                [1, 1],
                "F",
                true,
              );

              pdf.setFontSize(6.5);
              pdf.setTextColor(ink);
              pdf.text(
                fit(pdf, placed.item.title, sliceWidth - left - size - 2),
                cx + size / 2 + 1.5,
                cy + 1,
              );
              continue;
            }

            // Clip the bar to the slice, so a card spanning a break appears on
            // both pages, cut exactly at the boundary.
            const clippedLeft = Math.max(0, left);
            const clippedRight = Math.min(sliceWidth, right);
            const width = clippedRight - clippedLeft;
            if (width <= 0.05) {
              continue;
            }

            pdf.roundedRect(plotLeft + clippedLeft, y, width, placed.height, 1.2, 1.2, "F");

            if (placed.item.progress && placed.item.progress > 0) {
              const filledTo = left + placed.width * placed.item.progress;
              const progressWidth = Math.min(clippedRight, filledTo) - clippedLeft;
              if (progressWidth > 0.05) {
                pdf.setFillColor(0, 0, 0);
                pdf.setGState(pdf.GState({ opacity: 0.2 }));
                pdf.roundedRect(plotLeft + clippedLeft, y, progressWidth, placed.height, 1.2, 1.2, "F");
                pdf.setGState(pdf.GState({ opacity: 1 }));
              }
            }

            /*
             * Which side the title sits on was decided by the packer, which
             * reserved the space for it. Deciding again here would put labels
             * where nothing was set aside for them.
             */
            pdf.setFontSize(6.5);
            const baseline = y + placed.height / 2 + 1;
            if (placed.labelSide === "inside") {
              pdf.setTextColor(cardTextHex(placed.item.color));
              pdf.text(fit(pdf, placed.item.title, width - 3), plotLeft + clippedLeft + 1.5, baseline);
            } else if (placed.labelSide === "right") {
              pdf.setTextColor(ink);
              pdf.text(
                fit(pdf, placed.item.title, sliceWidth - clippedRight - 2),
                plotLeft + clippedRight + 1.5,
                baseline,
              );
            } else {
              pdf.setTextColor(ink);
              pdf.text(
                fit(pdf, placed.item.title, Math.max(0, clippedLeft - 2)),
                plotLeft + clippedLeft - 1.5,
                baseline,
                { align: "right" },
              );
            }
          }
        }

        /* --------------------------------------------------------- today -- */
        if (options.showToday) {
          const todayIso = today();
          if (todayIso >= doc.settings.start && todayIso <= doc.settings.end) {
            const x = xOf(todayIso, doc.settings.start, plan.mmPerDay) - column.startX;
            if (x >= 0 && x <= sliceWidth) {
              pdf.setDrawColor(accent);
              pdf.setLineWidth(0.4);
              pdf.line(plotLeft + x, plotTop, plotLeft + x, plotTop + sliceHeight);
            }
          }
        }

        /* -------------------------------------------------------- framing -- */
        pdf.setDrawColor(gridMajor);
        pdf.setLineWidth(0.2);
        pdf.rect(MARGIN, plotTop, box.width - MARGIN * 2, sliceHeight);

        pdf.setFontSize(6.5);
        pdf.setTextColor(inkSubtle);
        pdf.text(
          `${formatDate(doc.settings.start)} – ${formatDate(doc.settings.end)}`,
          MARGIN,
          box.height - MARGIN + 4,
        );
        pdf.text(`Page ${pageIndex} of ${plan.totalPages}`, box.width - MARGIN, box.height - MARGIN + 4, {
          align: "right",
        });
      }
    }

    return pdf;
  } finally {
    palette.dispose();
  }
}

export async function exportPdf(doc: TimelineDoc, options: ExportOptions): Promise<void> {
  const pdf = await buildPdf(doc, options);
  const safeTitle = options.title.replace(/[^\w\d\-. ]+/g, "").trim() || "timeline";
  pdf.save(`${safeTitle}.pdf`);
}
