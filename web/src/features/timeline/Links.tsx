import { memo } from "react";
import type { Link } from "@shared";
import type { Layout, PlacedItem } from "./geometry";
import { findPlacedItem } from "./geometry";

/*
 * Dependency arrows.
 *
 * Routed as three segments - out of the source, across, into the target -
 * rather than as a straight diagonal. Orthogonal routing is what keeps a dense
 * timeline readable: diagonals cross bars at arbitrary angles and turn into
 * noise as soon as there are more than a handful.
 */

/** How far the line runs straight out of a card before it turns. */
const STUB = 12;
const ARROW = 5;
/** Corner radius. Small enough that the route still reads as orthogonal. */
const CORNER = 7;

interface Point {
  x: number;
  y: number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Draws an orthogonal route through `points` with rounded corners.
 *
 * Each turn is cut back along both of its segments and bridged with a quadratic
 * curve through the original corner, so the line stays on the same gridlines
 * but arrives without the hard mitre. The cut is capped at half the shorter
 * neighbouring segment, which stops a tight dog-leg from curving back over
 * itself.
 */
export function roundedPath(points: Point[], radius = CORNER): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${round1(points[0]!.x)} ${round1(points[0]!.y)}`;

  const parts = [`M ${round1(points[0]!.x)} ${round1(points[0]!.y)}`];

  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;

    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cut = Math.min(radius, inLength / 2, outLength / 2);

    if (!Number.isFinite(cut) || cut < 0.5) {
      parts.push(`L ${round1(corner.x)} ${round1(corner.y)}`);
      continue;
    }

    const enterX = corner.x - ((corner.x - previous.x) / inLength) * cut;
    const enterY = corner.y - ((corner.y - previous.y) / inLength) * cut;
    const leaveX = corner.x + ((next.x - corner.x) / outLength) * cut;
    const leaveY = corner.y + ((next.y - corner.y) / outLength) * cut;

    parts.push(`L ${round1(enterX)} ${round1(enterY)}`);
    parts.push(`Q ${round1(corner.x)} ${round1(corner.y)} ${round1(leaveX)} ${round1(leaveY)}`);
  }

  const last = points[points.length - 1]!;
  parts.push(`L ${round1(last.x)} ${round1(last.y)}`);
  return parts.join(" ");
}

export function linkPath(from: PlacedItem, to: PlacedItem): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;

  // Enough room to route forwards: out, across, in.
  if (endX - startX >= STUB * 2) {
    const midX = startX + Math.max(STUB, (endX - startX) / 2);
    return roundedPath([
      { x: startX, y: startY },
      { x: midX, y: startY },
      { x: midX, y: endY },
      { x: endX - ARROW, y: endY },
    ]);
  }

  /*
   * The target starts before the source finishes, so a forward route would run
   * backwards straight through both cards. Route around instead.
   *
   * Prefer the clear horizontal band between the two cards - that keeps the
   * detour short and inside the space the eye already reads as "between these
   * rows". Only when the cards overlap vertically (same lane, or stacked with
   * no gap) is there no band to use, and the route drops below both.
   */
  const bandTop = Math.min(from.y + from.height, to.y + to.height);
  const bandBottom = Math.max(from.y, to.y);
  const detourY =
    bandBottom > bandTop
      ? (bandTop + bandBottom) / 2
      : Math.max(from.y + from.height, to.y + to.height) + 8;
  return roundedPath([
    { x: startX, y: startY },
    { x: startX + STUB, y: startY },
    { x: startX + STUB, y: detourY },
    { x: endX - STUB, y: detourY },
    { x: endX - STUB, y: endY },
    { x: endX - ARROW, y: endY },
  ]);
}

export const LinkLayer = memo(function LinkLayer({
  links,
  layout,
  width,
  height,
  highlightItemId,
}: {
  links: Link[];
  layout: Layout;
  width: number;
  height: number;
  /** Arrows touching this item are drawn in the accent colour. */
  highlightItemId?: string | null;
}) {
  if (links.length === 0) return null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={width}
      height={height}
    >
      <defs>
        <marker
          id="cp-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0.5 L7.5 4 L0 7.5 z" fill="currentColor" />
        </marker>
      </defs>

      {links.map((link) => {
        const from = findPlacedItem(layout, link.fromId);
        const to = findPlacedItem(layout, link.toId);
        // A link whose endpoint sits in a collapsed group has nothing to draw.
        if (!from || !to) return null;

        const active = highlightItemId === link.fromId || highlightItemId === link.toId;
        return (
          <path
            key={link.id}
            d={linkPath(from, to)}
            fill="none"
            strokeWidth={active ? 2 : 1.5}
            markerEnd="url(#cp-arrow)"
            className={
              active
                ? "text-accent transition-colors duration-[var(--dur-fast)]"
                : "text-ink-subtle transition-colors duration-[var(--dur-fast)]"
            }
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
});

/** The rubber-band line drawn while a new link is being dragged out. */
export function PendingLink({
  from,
  x,
  y,
}: {
  from: PlacedItem;
  x: number;
  y: number;
}) {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  return (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible">
      <path
        d={`M ${startX} ${startY} L ${x} ${y}`}
        className="text-accent"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray="4 3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx={x} cy={y} r={3} className="fill-accent" />
    </svg>
  );
}
