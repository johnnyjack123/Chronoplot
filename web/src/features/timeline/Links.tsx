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

export function linkPath(from: PlacedItem, to: PlacedItem): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;

  // Enough room to route forwards: out, across, in.
  if (endX - startX >= STUB * 2) {
    const midX = startX + Math.max(STUB, (endX - startX) / 2);
    return `M ${startX} ${startY} H ${midX} V ${endY} H ${endX - ARROW}`;
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
  return [
    `M ${startX} ${startY}`,
    `H ${startX + STUB}`,
    `V ${detourY}`,
    `H ${endX - STUB}`,
    `V ${endY}`,
    `H ${endX - ARROW}`,
  ].join(" ");
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
