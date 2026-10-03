/*
 * Standalone HTML export.
 *
 * Produces one self-contained file - no scripts, fonts or styles fetched from
 * anywhere - so it works offline, inside an Obsidian note, or in an <iframe> on
 * a site with a strict content policy.
 *
 * The drawing is SVG emitted from the same geometry module the editor and the
 * PDF use. Zooming is a transform on that drawing rather than a re-layout: a
 * re-layout would mean shipping the tick generator and packer into the file and
 * maintaining a second copy of them. The trade-off is that text scales with the
 * view like a map rather than staying a fixed size - which is why every card
 * also carries its exact dates in a hover tooltip, where the detail actually
 * matters.
 *
 * Everything interpolated into the output is escaped. The content is user data
 * and the result is meant to be embedded in other people's pages.
 */
import type { ThemeName, TimelineDoc } from "@shared";
import { formatWithPrecision, inclusiveDays, today } from "@/lib/dates";
import {
  buildAxis, laneColumnWidth, layout as computeLayout, xOf, findPlacedItem,
  type Layout, type PlacedItem,
} from "@/features/timeline/geometry";
import { linkPath } from "@/features/timeline/Links";
import {
  LANE_TINT_STRENGTH, resolveCardHex, resolveCardInkHex, resolveToken,
} from "@/features/timeline/colors";

export interface HtmlExportOptions {
  title: string;
  theme: ThemeName;
  /** Draws lane names down the left edge. */
  showLaneLabels: boolean;
  /**
   * Leaves the background unpainted, so whatever the file is placed on shows
   * through. Text and gridlines still come from the chosen theme, so pick one
   * whose ink suits the surface underneath - a dark theme's pale text is
   * invisible on white.
   */
  transparent?: boolean;
}

/** Layout constants for the exported drawing, in SVG user units. */
const HTML_LAYOUT = {
  cardHeight: 26,
  cardGap: 5,
  lanePadding: 6,
  groupHeaderHeight: 24,
  groupGap: 10,
  labelCharWidth: 6.4,
  labelGap: 8,
  minItemGap: 6,
  labelInset: 8,
};

/**
 * Metrics for the lane-name column, in SVG user units.
 *
 * Lane names are 12px, group headings 10px bold uppercase - hence the wider
 * per-glyph figure for those. The column is sized from the labels themselves;
 * a fixed width simply cut off any name longer than the guess.
 */
const LANE_COLUMN = {
  charWidth: 6.4,
  groupCharWidth: 6.8,
  indent: 10,
  padding: 20,
  min: 90,
  max: 420,
};

const AXIS_HEIGHT = 44;
const PADDING = 16;
/** Width the timeline is laid out at before any zooming. */
const BASE_WIDTH = 1440;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function readPalette(theme: ThemeName) {
  const probe = document.createElement("div");
  probe.setAttribute("data-theme", theme);
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const read = {
    token: (name: string, fallback: string) => resolveToken(name, probe) || fallback,
    card: (slot: number) => resolveCardHex(slot, probe),
    cardInk: (slot: number) => resolveCardInkHex(slot, probe),
    dispose: () => probe.remove(),
  };
  return read;
}

function describe(placed: PlacedItem): string {
  const { item } = placed;
  if (item.kind === "milestone") return formatWithPrecision(item.start, item.precision);
  const days = inclusiveDays(item.start, item.end);
  return `${formatWithPrecision(item.start, item.precision)} – ${formatWithPrecision(item.end, item.precision)} · ${days} day${days === 1 ? "" : "s"}`;
}

function renderCards(layout: Layout, palette: ReturnType<typeof readPalette>): string {
  const parts: string[] = [];

  for (const lane of layout.lanes) {
    for (const placed of lane.items) {
      const { item } = placed;
      const fill = palette.card(item.color);
      const title = escapeHtml(item.title);
      const range = escapeHtml(describe(placed));
      const mid = placed.y + placed.height / 2;

      // The tooltip text rides along on the element, so the script needs no
      // copy of the model.
      const meta = `class="cp-card" data-title="${title}" data-range="${range}"`;

      /*
       * A card that came from a note links back to it. The scheme was validated
       * when the item was stored - only obsidian:// and https:// get that far -
       * so this cannot become a javascript: link here.
       *
       * A real anchor rather than a click handler, so the link survives with
       * scripting off and right-click still offers "copy link". `obsidian://`
       * is handed to the OS, so it must not open a tab first: a new window
       * would be left behind empty.
       */
      const link = item.source?.url;
      const external = link?.toLowerCase().startsWith("https://");
      const open = link
        ? `<a class="cp-link" href="${escapeHtml(link)}"${external ? ` target="_blank" rel="noopener"` : ""}>`
        : "";
      const close = link ? `</a>` : "";

      if (item.kind === "milestone") {
        const size = placed.height * 0.62;
        parts.push(
          open +
            `<g ${meta}>` +
            `<rect x="${placed.x}" y="${mid - size / 2}" width="${size}" height="${size}" rx="3" fill="${fill}" transform="rotate(45 ${placed.x + size / 2} ${mid})"/>` +
            `<text x="${placed.x + size + 6}" y="${mid + 4}" class="cp-outside">${title}</text>` +
            `</g>` +
            close,
        );
        continue;
      }

      const label =
        placed.labelSide === "inside"
          ? `<text x="${placed.x + 8}" y="${mid + 4}" class="cp-inside" fill="${palette.cardInk(item.color)}">${title}</text>`
          : placed.labelSide === "right"
            ? `<text x="${placed.x + placed.width + 8}" y="${mid + 4}" class="cp-outside">${title}</text>`
            : `<text x="${placed.x - 8}" y="${mid + 4}" class="cp-outside" text-anchor="end">${title}</text>`;

      const progress =
        item.progress && item.progress > 0
          ? `<rect x="${placed.x}" y="${placed.y}" width="${placed.width * Math.min(1, item.progress)}" height="${placed.height}" rx="5" fill="#000" opacity="0.2"/>`
          : "";

      parts.push(
        open +
          `<g ${meta}>` +
          `<rect x="${placed.x}" y="${placed.y}" width="${Math.max(placed.width, 2)}" height="${placed.height}" rx="5" fill="${fill}"/>` +
          progress +
          label +
          `</g>` +
          close,
      );
    }
  }
  return parts.join("");
}

/**
 * Both outputs come from here.
 *
 * The interactive page and the flat SVG draw exactly the same thing - only the
 * wrapper differs - so producing them from one pass is what stops a fix landing
 * in one and not the other. The SVG carries its own `<style>`, because a
 * rasteriser hands it no page to inherit from.
 */
function render(doc: TimelineDoc, options: HtmlExportOptions, mode: "html" | "svg"): string {
  const palette = readPalette(options.theme);

  try {
    const days = Math.max(1, inclusiveDays(doc.settings.start, doc.settings.end));
    const unitsPerDay = BASE_WIDTH / days;

    const layout = computeLayout(doc, { ...HTML_LAYOUT, unitsPerDay });
    const axis = buildAxis(doc, unitsPerDay);

    const plotWidth = Math.max(layout.totalWidth, 1);
    const plotHeight = Math.max(layout.totalHeight, 1);
    const laneColumn = options.showLaneLabels ? laneColumnWidth(doc, LANE_COLUMN) : 0;

    /*
     * A title the packer could place on neither side overhangs the plot, and
     * sizing the canvas to the plot alone simply cut it off - the longest
     * labels, the ones most worth reading, were the ones that vanished. The
     * lane column already provides room on the left, so only what reaches past
     * it has to be added.
     */
    const overhangLeft = Math.max(0, layout.overflow.left - laneColumn);
    const overhangRight = layout.overflow.right;

    // Everything that positions lane names and the axis rule measures from the
    // plot's left edge, so this stays the lane column alone; the overhang only
    // moves the whole drawing and widens the canvas.
    const labelWidth = laneColumn;
    const totalWidth = laneColumn + overhangLeft + plotWidth + overhangRight + PADDING * 2;
    const totalHeight = AXIS_HEIGHT + plotHeight + PADDING * 2;

    const canvas = palette.token("--canvas", "#0b0f16");
    const surface = palette.token("--surface", "#121721");
    const ink = palette.token("--ink", "#e8ecf3");
    const inkMuted = palette.token("--ink-muted", "#98a4ba");
    const inkSubtle = palette.token("--ink-subtle", "#6a7689");
    const gridMinor = palette.token("--grid-line", "rgba(255,255,255,0.1)");
    const gridMajor = palette.token("--grid-line-strong", "rgba(255,255,255,0.2)");
    const accent = palette.token("--accent", "#6d8cff");
    const border = palette.token("--border", "rgba(255,255,255,0.08)");

    /* ------------------------------------------------------------- axis -- */
    const upperTicks = axis.upper
      .map(
        (tick) =>
          `<text x="${tick.x + 4}" y="14" class="cp-axis-upper">${escapeHtml(tick.label)}</text>` +
          (tick.x > 0 ? `<line x1="${tick.x}" y1="0" x2="${tick.x}" y2="${AXIS_HEIGHT + plotHeight}" stroke="${gridMajor}"/>` : ""),
      )
      .join("");

    const lowerTicks = axis.lower
      .map((tick) => {
        const label =
          tick.width > 26
            ? `<text x="${tick.x + tick.width / 2}" y="${AXIS_HEIGHT - 10}" class="cp-axis-lower">${escapeHtml(tick.label)}</text>`
            : "";
        const line =
          tick.x > 0
            ? `<line x1="${tick.x}" y1="${AXIS_HEIGHT}" x2="${tick.x}" y2="${AXIS_HEIGHT + plotHeight}" stroke="${gridMinor}"/>`
            : "";
        return label + line;
      })
      .join("");

    const weekends = axis.weekendBands
      .map(
        (band) =>
          `<rect x="${band.x}" y="${AXIS_HEIGHT}" width="${band.width}" height="${plotHeight}" fill="${ink}" opacity="0.035"/>`,
      )
      .join("");

    /* ------------------------------------------------------------ lanes -- */
    // Lane washes go first so gridlines and cards land on top of them.
    const laneWashes = layout.lanes
      .filter((lane) => lane.color !== undefined)
      .map(
        (lane) =>
          `<rect x="${-labelWidth}" y="${lane.y}" width="${labelWidth + plotWidth}" height="${lane.height}" fill="${palette.card(lane.color!)}" opacity="${LANE_TINT_STRENGTH}"/>`,
      )
      .join("");

    const laneRows = layout.lanes
      .map(
        (lane) =>
          `<line x1="${-labelWidth}" y1="${lane.y + lane.height}" x2="${plotWidth}" y2="${lane.y + lane.height}" stroke="${gridMinor}"/>` +
          (options.showLaneLabels
            ? `<text x="${-labelWidth + (lane.groupId ? 18 : 8)}" y="${lane.y + lane.height / 2 + 4}" class="cp-lane">${escapeHtml(lane.title)}</text>`
            : ""),
      )
      .join("");

    /*
     * The rule between the lane names and the plot. Without it the names read
     * as stray text floating beside the bars rather than as a column.
     */
    const laneDivider = options.showLaneLabels
      ? `<line x1="0" y1="0" x2="0" y2="${AXIS_HEIGHT + plotHeight}" stroke="${gridMajor}" stroke-width="1.5"/>`
      : "";

    const groupRows = layout.groups
      .map(
        (group) =>
          `<rect x="${-labelWidth}" y="${group.y}" width="${labelWidth + plotWidth}" height="${group.height}" fill="${ink}" opacity="0.02"/>` +
          (options.showLaneLabels
            ? `<text x="${-labelWidth + 8}" y="${group.y + 15}" class="cp-group">${escapeHtml(group.title.toUpperCase())}</text>`
            : ""),
      )
      .join("");

    /* ------------------------------------------------------------ links -- */
    const links = doc.settings.showLinks
      ? doc.links
          .map((link) => {
            const from = findPlacedItem(layout, link.fromId);
            const to = findPlacedItem(layout, link.toId);
            if (!from || !to) return "";
            return `<path d="${linkPath(from, to)}" fill="none" stroke="${inkSubtle}" stroke-width="1.5" marker-end="url(#cp-arrow)"/>`;
          })
          .join("")
      : "";

    const todayIso = today();
    const todayLine =
      doc.settings.showToday && todayIso >= doc.settings.start && todayIso <= doc.settings.end
        ? `<line x1="${xOf(todayIso, doc.settings.start, unitsPerDay)}" y1="0" x2="${xOf(todayIso, doc.settings.start, unitsPerDay)}" y2="${AXIS_HEIGHT + plotHeight}" stroke="${accent}" stroke-width="2" opacity="0.75"/>`
        : "";

    const range = `${formatWithPrecision(doc.settings.start, "day")} – ${formatWithPrecision(doc.settings.end, "day")}`;

    /* The drawing itself, identical in both outputs. */
    const drawing =
      `<defs>` +
      `<marker id="cp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M0 .5 L7.5 4 L0 7.5 z" fill="${inkSubtle}"/>` +
      `</marker>` +
      `</defs>` +
      `<g transform="translate(${PADDING + laneColumn + overhangLeft} ${PADDING})">` +
      `<g transform="translate(0 ${AXIS_HEIGHT})">${laneWashes}${weekends}${groupRows}${laneRows}</g>` +
      `${upperTicks}${lowerTicks}` +
      `<line x1="${-labelWidth}" y1="${AXIS_HEIGHT}" x2="${plotWidth}" y2="${AXIS_HEIGHT}" stroke="${gridMajor}" stroke-width="1.5"/>` +
      `${laneDivider}` +
      `<g transform="translate(0 ${AXIS_HEIGHT})">${links}${renderCards(layout, palette)}</g>` +
      `${todayLine}` +
      `</g>`;

    /*
     * Only the classes the drawing actually uses. The page's own chrome - the
     * stage, the tooltip, the buttons - has no meaning in a flat image.
     */
    const drawingCss =
      `.cp-axis-upper { fill: ${inkMuted}; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }` +
      `.cp-axis-lower { fill: ${inkSubtle}; font-size: 11px; text-anchor: middle; }` +
      `.cp-lane { fill: ${ink}; font-size: 12px; }` +
      `.cp-group { fill: ${inkMuted}; font-size: 10px; font-weight: 600; letter-spacing: .05em; }` +
      `.cp-inside { font-size: 12px; font-weight: 500; }` +
      `.cp-outside { fill: ${ink}; font-size: 11px; }`;

    if (mode === "svg") {
      /*
       * A system font stack would rasterise differently on every machine, so
       * the family is named here and the rasteriser is given something it can
       * resolve. The background rect is omitted entirely when transparent -
       * painting it in a fully transparent colour would still flatten anything
       * placed behind it in some viewers.
       */
      const background = options.transparent
        ? ""
        : `<rect width="${totalWidth}" height="${totalHeight}" fill="${canvas}"/>`;

      return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" ` +
        `viewBox="0 0 ${totalWidth} ${totalHeight}">` +
        `<style>` +
        `text { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }` +
        drawingCss +
        `</style>` +
        background +
        drawing +
        `</svg>`
      );
    }

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>
  :root { color-scheme: ${["daylight", "parchment"].includes(options.theme) ? "light" : "dark"}; }
  * { box-sizing: border-box; }
  /*
   * Transparent leaves the page unpainted so the note or site behind it shows
   * through - which is the point of embedding it in Obsidian rather than
   * pasting a screenshot.
   */
  body {
    margin: 0; background: ${options.transparent ? "transparent" : canvas}; color: ${ink};
    font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .cp-root { position: relative; width: 100%; height: 100vh; overflow: hidden; }
  /*
   * Nothing here is text to select - it is a drawing you drag. Leaving
   * selection on meant every pan swept a blue highlight across the labels it
   * passed over.
   */
  .cp-stage {
    position: absolute; inset: 0; cursor: grab; touch-action: none;
    user-select: none; -webkit-user-select: none;
  }
  .cp-stage.cp-dragging { cursor: grabbing; }
  .cp-surface { transform-origin: 0 0; will-change: transform; }
  .cp-axis-upper { fill: ${inkMuted}; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .cp-axis-lower { fill: ${inkSubtle}; font-size: 11px; text-anchor: middle; font-variant-numeric: tabular-nums; }
  .cp-lane { fill: ${ink}; font-size: 12px; }
  .cp-group { fill: ${inkMuted}; font-size: 10px; font-weight: 600; letter-spacing: .05em; }
  .cp-inside { font-size: 12px; font-weight: 500; }
  .cp-outside { fill: ${ink}; font-size: 11px; }
  .cp-card { cursor: default; }
  .cp-card:hover { filter: brightness(1.08); }
  /* A card backed by a note is the only clickable thing on the canvas. */
  .cp-link { cursor: pointer; }
  .cp-link:hover .cp-card { filter: brightness(1.14); }

  .cp-bar {
    position: absolute; left: 12px; top: 12px; right: 12px;
    display: flex; align-items: center; gap: 10px;
    pointer-events: none;
  }
  .cp-title { font-size: 15px; font-weight: 600; }
  .cp-range { font-size: 12px; color: ${inkSubtle}; font-variant-numeric: tabular-nums; }
  .cp-controls { margin-left: auto; display: flex; gap: 6px; pointer-events: auto; }
  .cp-controls button {
    width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
    border: 1px solid ${border}; background: ${surface}; color: ${ink};
    font-size: 15px; line-height: 1; display: grid; place-items: center;
  }
  .cp-controls button:hover { border-color: ${accent}; color: ${accent}; }
  .cp-controls button.cp-wide { width: auto; padding: 0 10px; font-size: 12px; }

  .cp-tip {
    position: absolute; z-index: 5; pointer-events: none; opacity: 0;
    transition: opacity .12s ease; max-width: 280px;
    border: 1px solid ${border}; border-radius: 8px; background: ${surface};
    padding: 7px 10px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
  }
  .cp-tip.cp-on { opacity: 1; }
  .cp-tip b { display: block; font-size: 13px; font-weight: 600; }
  .cp-tip span { font-size: 12px; color: ${inkMuted}; font-variant-numeric: tabular-nums; }
  .cp-hint { position: absolute; right: 12px; bottom: 10px; font-size: 11px; color: ${inkSubtle}; }
</style>
</head>
<body>
<div class="cp-root">
  <div class="cp-stage" id="cp-stage">
    <svg class="cp-surface" id="cp-surface" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">${drawing}</svg>
  </div>

  <div class="cp-bar">
    <span class="cp-title">${escapeHtml(options.title)}</span>
    <span class="cp-range">${escapeHtml(range)}</span>
    <span class="cp-controls">
      <button type="button" id="cp-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
      <button type="button" id="cp-in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" class="cp-wide" id="cp-fit" title="Fit to window">Fit</button>
    </span>
  </div>

  <div class="cp-tip" id="cp-tip"><b></b><span></span></div>
  <p class="cp-hint">Drag or scroll to pan · Ctrl + scroll to zoom</p>
</div>

<script>
(function () {
  var stage = document.getElementById("cp-stage");
  var surface = document.getElementById("cp-surface");
  var tip = document.getElementById("cp-tip");
  var W = ${totalWidth}, H = ${totalHeight};
  var scale = 1, tx = 0, ty = 0;

  function apply() {
    surface.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
  }

  function fit() {
    var r = stage.getBoundingClientRect();
    scale = Math.min(r.width / W, r.height / H, 1);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    tx = (r.width - W * scale) / 2;
    ty = (r.height - H * scale) / 2;
    if (ty < 0) ty = 0;
    apply();
  }

  // Zoom about a point so the content under the cursor stays put.
  function zoomAt(clientX, clientY, factor) {
    var r = stage.getBoundingClientRect();
    var px = clientX - r.left, py = clientY - r.top;
    var next = Math.min(8, Math.max(0.05, scale * factor));
    if (next === scale) return;
    tx = px - (px - tx) * (next / scale);
    ty = py - (py - ty) * (next / scale);
    scale = next;
    apply();
  }

  /*
   * Ctrl or Cmd plus wheel zooms; a plain wheel scrolls, both ways. A trackpad
   * reports sideways gestures as deltaX, so honouring it is what makes
   * two-finger horizontal scrolling work - and it matches how every map and
   * canvas behaves, which is what people try first.
   */
  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      return;
    }
    // Shift turns a vertical wheel into a horizontal one, for mice with only
    // one axis.
    if (e.shiftKey && e.deltaX === 0) tx -= e.deltaY;
    else { tx -= e.deltaX; ty -= e.deltaY; }
    apply();
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0, pointer = null, travelled = 0;
  stage.addEventListener("pointerdown", function (e) {
    // Stops the browser starting a text selection or a native image drag.
    // Cancelling pointerdown suppresses mousedown but not click, so the links
    // on source-backed cards still activate.
    e.preventDefault();
    dragging = true; pointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    travelled = 0;
    stage.setPointerCapture(pointer);
    stage.classList.add("cp-dragging");
  });
  stage.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    travelled += Math.abs(dx) + Math.abs(dy);
    tx += dx; ty += dy;
    lastX = e.clientX; lastY = e.clientY;
    apply();
  });

  /*
   * Panning that happens to start on a linked card must not end in a jump to
   * Obsidian. The click lands after the drag, so it is cancelled once the
   * pointer has moved further than a shaky hand would.
   */
  stage.addEventListener("click", function (e) {
    if (travelled > 6) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove("cp-dragging");
    if (pointer !== null && stage.hasPointerCapture(pointer)) stage.releasePointerCapture(pointer);
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // Hover detail. One listener on the stage rather than one per card.
  stage.addEventListener("pointermove", function (e) {
    if (dragging) { tip.classList.remove("cp-on"); return; }
    var card = e.target.closest ? e.target.closest(".cp-card") : null;
    if (!card) { tip.classList.remove("cp-on"); return; }
    tip.querySelector("b").textContent = card.getAttribute("data-title") || "";
    tip.querySelector("span").textContent = card.getAttribute("data-range") || "";
    tip.classList.add("cp-on");
    var r = stage.getBoundingClientRect();
    var x = e.clientX - r.left + 16, y = e.clientY - r.top + 18;
    if (x + tip.offsetWidth > r.width) x = r.width - tip.offsetWidth - 8;
    if (y + tip.offsetHeight > r.height) y = y - tip.offsetHeight - 30;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  });
  stage.addEventListener("pointerleave", function () { tip.classList.remove("cp-on"); });

  document.getElementById("cp-in").addEventListener("click", function () {
    var r = stage.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.4);
  });
  document.getElementById("cp-out").addEventListener("click", function () {
    var r = stage.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.4);
  });
  document.getElementById("cp-fit").addEventListener("click", fit);

  addEventListener("resize", fit);
  fit();
})();
</script>
</body>
</html>`;
  } finally {
    palette.dispose();
  }
}

/** The interactive, self-contained page. */
export function buildHtml(doc: TimelineDoc, options: HtmlExportOptions): string {
  return render(doc, options, "html");
}

/** The same drawing as a flat SVG, carrying its own styles. */
export function buildSvg(doc: TimelineDoc, options: HtmlExportOptions): string {
  return render(doc, options, "svg");
}

/** Pixel dimensions a PNG would have at the given multiplier. */
export function pngSize(doc: TimelineDoc, options: HtmlExportOptions, scale: number): { width: number; height: number } {
  const svg = buildSvg(doc, options);
  const width = Number(/\swidth="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0);
  const height = Number(/\sheight="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Rasterises the drawing to a PNG.
 *
 * Via an `<img>` and a canvas rather than a library: the SVG is already the
 * exact thing on screen, so anything that re-draws it is a second renderer to
 * keep in agreement. The image is loaded from a data URL rather than a blob
 * URL because a blob URL taints the canvas in some browsers, and a tainted
 * canvas cannot be read back - the export would fail at the last step.
 */
export async function exportPng(
  doc: TimelineDoc,
  options: HtmlExportOptions,
  scale = 2,
): Promise<void> {
  const svg = buildSvg(doc, options);
  const { width, height } = pngSize(doc, options, scale);

  if (width <= 0 || height <= 0) throw new Error("The timeline has no drawable area.");
  // Browsers refuse canvases beyond roughly this, and fail by returning a blank
  // image rather than by throwing - so say what happened instead.
  if (width > 16384 || height > 16384) {
    throw new Error(
      `At ${scale}x the image would be ${width}x${height} pixels, which browsers cannot produce. Choose a smaller scale.`,
    );
  }

  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  image.decoding = "sync";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The drawing could not be rasterised."));
    image.src = encoded;
  });

  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const context = canvasEl.getContext("2d");
  if (!context) throw new Error("This browser provided no 2D canvas context.");

  // Nothing is painted first, so an omitted background rect stays transparent.
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvasEl.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The image could not be encoded.");

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${options.title.replace(/[^\w\d\-. ]+/g, "").trim() || "timeline"}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportHtml(doc: TimelineDoc, options: HtmlExportOptions): void {
  const blob = new Blob([buildHtml(doc, options)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${options.title.replace(/[^\w\d\-. ]+/g, "").trim() || "timeline"}.html`;
  anchor.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
