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
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" style={{ width, height }}>
      {axis.weekendBands.map((band, index) => (
        <div
          key={`weekend-${index}`}
          className="absolute top-0 bg-ink/[0.035]"
          style={{ left: band.x, width: band.width, height }}
        />
      ))}

      {axis.lower.map((tick) => (
        <div
          key={`minor-${tick.date}`}
          className="absolute top-0 w-px bg-line"
          style={{ left: tick.x, height }}
        />
      ))}

      {axis.majorLines.map((x) => (
        <div key={`major-${x}`} className="absolute top-0 w-px bg-line-strong" style={{ left: x, height }} />
      ))}
    </div>
  );
});
