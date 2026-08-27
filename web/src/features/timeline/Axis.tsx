import { memo } from "react";
import type { Axis as AxisModel } from "./geometry";

/*
 * The two-tier time header. The coarse tier labels the span it covers and is
 * centred over it; the fine tier ticks at the document's granularity.
 *
 * Labels are only drawn when their span is wide enough to hold them - a header
 * of overlapping half-hidden month names is worse than one with gaps.
 */
const MIN_LABEL_WIDTH = 26;

export const TimeAxis = memo(function TimeAxis({
  axis,
  width,
}: {
  axis: AxisModel;
  width: number;
}) {
  return (
    <div
      className="relative shrink-0 select-none border-b border-line-strong bg-surface"
      style={{ width, height: "var(--axis-height)" }}
    >
      {/* Coarse tier */}
      <div className="relative h-7 border-b border-line">
        {axis.upper.map((tick) => (
          <div
            key={`${tick.date}-upper`}
            className="absolute top-0 flex h-7 items-center border-l border-line-strong px-2"
            style={{ left: tick.x, width: tick.width }}
          >
            {tick.width >= MIN_LABEL_WIDTH * 2 ? (
              <span className="truncate-1 text-micro uppercase text-ink-muted">{tick.label}</span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Fine tier */}
      <div className="relative h-[calc(var(--axis-height)-1.75rem)]">
        {axis.lower.map((tick) => (
          <div
            key={`${tick.date}-lower`}
            className="absolute top-0 flex h-full items-center justify-center border-l border-line"
            style={{ left: tick.x, width: tick.width }}
          >
            {tick.width >= MIN_LABEL_WIDTH ? (
              <span className="tabular truncate-1 px-1 text-caption text-ink-subtle">
                {tick.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * Gridlines and weekend shading behind the plot. Separated from the axis so it
 * can sit under the cards while the header stays pinned above them.
 */
export const PlotBackground = memo(function PlotBackground({
  axis,
  width,
  height,
}: {
  axis: AxisModel;
  width: number;
  height: number;
}) {
  /*
   * Drawn as one SVG rather than a div per gridline. The axis is already
   * windowed to the viewport, but a long timeline still produces a few hundred
   * lines per screen, and that many absolutely-positioned elements costs far
   * more in layout and paint than a single path does.
   */
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
    >
      {axis.weekendBands.map((band, index) => (
        <rect
          key={`weekend-${index}`}
          x={band.x}
          y={0}
          width={band.width}
          height={height}
          className="fill-ink/[0.035]"
        />
      ))}

      {axis.lower.map((tick) => (
        <line
          key={`minor-${tick.date}`}
          x1={tick.x + 0.5}
          x2={tick.x + 0.5}
          y1={0}
          y2={height}
          className="stroke-line"
          strokeWidth={1}
        />
      ))}

      {axis.majorLines.map((x) => (
        <line
          key={`major-${x}`}
          x1={x + 0.5}
          x2={x + 0.5}
          y1={0}
          y2={height}
          className="stroke-line-strong"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
});
