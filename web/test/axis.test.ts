/*
 * Axis windowing and zoom-based coarsening.
 * Run with:  npx tsx --tsconfig web/tsconfig.json web/test/axis.test.ts
 *
 * These are the checks that keep a century-long timeline usable. The cost of
 * drawing the axis must depend on the size of the viewport, never on the length
 * of the timeline.
 */
import type { TimelineDoc } from "../../shared/src/index.ts";
import { buildAxis, effectiveUnits, clampZoom, MIN_UNITS_PER_DAY, MAX_UNITS_PER_DAY } from "../src/features/timeline/geometry.ts";

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

const doc = (start: string, end: string, extra: Partial<TimelineDoc["settings"]> = {}): TimelineDoc => ({
  schemaVersion: 1,
  settings: {
    start, end, granularity: "day", theme: "midnight",
    showToday: true, showWeekends: true, showLinks: true, ...extra,
  },
  groups: [], rows: [{ id: "r", groupId: null, title: "Lane" }], items: [], links: [],
});

/* 1. Coarsening: day ticks must give way as the view zooms out. */
{
  check("day ticks at full zoom", effectiveUnits("day", 20).lower === "day");
  check("weeks take over when days shrink", effectiveUnits("day", 3).lower === "week", effectiveUnits("day", 3).lower);
  check("months take over further out", effectiveUnits("day", 1.2).lower === "month", effectiveUnits("day", 1.2).lower);
  check("years take over at century scale", ["year", "decade"].includes(effectiveUnits("day", 0.05).lower), effectiveUnits("day", 0.05).lower);
  check("decades at the far end", effectiveUnits("day", 0.002).lower === "decade", effectiveUnits("day", 0.002).lower);
  check("never refines past the setting", effectiveUnits("year", 40).lower === "year", effectiveUnits("year", 40).lower);
  check("upper tier is always coarser", effectiveUnits("day", 20).upper === "month");
}

/* 2. A century of days, windowed to one screen, must stay small and quick. */
{
  const century = doc("2000-01-01", "2100-12-31");
  const started = Date.now();
  const axis = buildAxis(century, 20, { fromX: 500_000, toX: 502_000 });
  const elapsed = Date.now() - started;

  check("windowed axis is cheap", elapsed < 150, `${elapsed}ms`);
  check("windowed axis has few lower ticks", axis.lower.length < 400, `${axis.lower.length}`);
  check("windowed axis has few upper ticks", axis.upper.length < 100, `${axis.upper.length}`);
  check("weekend bands stay bounded", axis.weekendBands.length < 400, `${axis.weekendBands.length}`);
  check(
    "ticks lie inside the requested window",
    axis.lower.every((tick) => tick.x + tick.width >= 499_000 && tick.x <= 503_000),
  );
}

/* 3. Zoomed out over the same century, coarsening must keep the count sane. */
{
  const century = doc("2000-01-01", "2100-12-31");
  const started = Date.now();
  const axis = buildAxis(century, 0.01, { fromX: 0, toX: 1400 });
  const elapsed = Date.now() - started;

  check("zoomed-out axis is cheap", elapsed < 150, `${elapsed}ms`);
  check("zoomed-out axis coarsens", axis.units.lower !== "day", axis.units.lower);
  check("zoomed-out tick count is small", axis.lower.length < 200, `${axis.lower.length}`);
  check("no weekend smear when zoomed out", axis.weekendBands.length === 0, `${axis.weekendBands.length}`);
}

/* 4. The pathological case from the bug report: a mistyped year producing a
 *    two-thousand-year span must not explode. */
{
  const absurd = doc("0002-01-01", "2026-12-31");
  const started = Date.now();
  const axis = buildAxis(absurd, 0.5, { fromX: 0, toX: 1400 });
  const elapsed = Date.now() - started;

  check("two-millennia span still builds fast", elapsed < 200, `${elapsed}ms`);
  check("two-millennia span stays bounded", axis.lower.length < 300, `${axis.lower.length}`);
}

/* 5. Full-range build (what the PDF exporter does) must still cover everything. */
{
  const decade = doc("2020-01-01", "2029-12-31", { granularity: "year" });
  const axis = buildAxis(decade, 1);
  check("full build covers every year", axis.lower.length === 10, `${axis.lower.length}`);
  check("full build starts at x=0", axis.lower[0]?.x === 0, `${axis.lower[0]?.x}`);
}

/* 6. Zoom clamping. */
{
  check("zoom clamps low", clampZoom(0.0000001) === MIN_UNITS_PER_DAY);
  check("zoom clamps high", clampZoom(9999) === MAX_UNITS_PER_DAY);
  check(
    "a century fits a normal screen at minimum zoom",
    36_525 * MIN_UNITS_PER_DAY < 200,
    `${Math.round(36_525 * MIN_UNITS_PER_DAY)}px per century`,
  );
}

console.log(failed === 0 ? "\nAll axis checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
