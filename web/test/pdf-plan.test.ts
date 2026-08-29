/*
 * Checks for PDF pagination. Run with:  npx tsx web/test/pdf-plan.test.ts
 *
 * The cases that matter are the ones that would either loop forever or produce
 * a silently wrong page count: a timeline far wider than a page, a lane taller
 * than a page, and the "fit to one page" scale.
 */
import type { TimelineDoc } from "../../shared/src/index.ts";
import { planPages, type ExportOptions } from "../src/features/export/pdf-plan.ts";

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

function makeDoc(overrides: Partial<TimelineDoc> = {}): TimelineDoc {
  return {
    schemaVersion: 1,
    settings: {
      start: "2026-01-01",
      end: "2026-12-31",
      granularity: "month",
      theme: "daylight",
      showToday: true,
      showWeekends: false,
      showLinks: true,
    },
    groups: [],
    rows: [{ id: "r1", groupId: null, title: "Lane 1" }],
    items: [],
    links: [],
    ...overrides,
  };
}

const baseOptions: ExportOptions = {
  pageSize: "a4",
  orientation: "landscape",
  mmPerDay: null,
  verticalScale: 1,
  theme: "daylight",
  title: "Test",
  repeatLaneLabels: true,
  showToday: true,
};

/* 1. Fit-to-page always produces exactly one column. */
{
  const plan = planPages(makeDoc(), baseOptions);
  check("fit scale gives one column", plan.columns.length === 1, `got ${plan.columns.length}`);
  check("fit scale gives one page", plan.totalPages === 1, `got ${plan.totalPages}`);
  check("fit scale derives a positive mm/day", plan.mmPerDay > 0, `got ${plan.mmPerDay}`);
}

/* 2. A fixed scale wide enough to overflow must split horizontally. */
{
  const plan = planPages(makeDoc(), { ...baseOptions, mmPerDay: 3 });
  check("wide scale splits into several columns", plan.columns.length > 1, `got ${plan.columns.length}`);
  check(
    "columns tile the plot with no gap or overlap",
    plan.columns.every((column, index) =>
      index === 0 ? column.startX === 0 : column.startX === plan.columns[index - 1]!.endX,
    ),
  );
  check(
    "last column ends at the plot width",
    Math.abs(plan.columns[plan.columns.length - 1]!.endX - plan.plotWidth) < 0.01,
  );
}

/* 3. Many lanes must split vertically, and never inside a lane. */
{
  const rows = Array.from({ length: 60 }, (_, index) => ({
    id: `r${index}`,
    groupId: null,
    title: `Lane ${index}`,
  }));
  const plan = planPages(makeDoc({ rows }), baseOptions);
  check("many lanes split into several rows", plan.rows.length > 1, `got ${plan.rows.length}`);
  check(
    "row slices tile the plot",
    plan.rows.every((row, index) =>
      index === 0 ? row.startY === 0 : row.startY === plan.rows[index - 1]!.endY,
    ),
  );
  check("total pages is columns x rows", plan.totalPages === plan.columns.length * plan.rows.length);
}

/* 4. A single-day timeline must not divide by zero or produce zero pages. */
{
  const plan = planPages(
    makeDoc({
      settings: { ...makeDoc().settings, start: "2026-05-04", end: "2026-05-04", granularity: "day" },
    }),
    baseOptions,
  );
  check("single-day timeline yields one page", plan.totalPages === 1, `got ${plan.totalPages}`);
}

/* 5. A ten-year daily timeline at a fine scale must still terminate. */
{
  const started = Date.now();
  const plan = planPages(
    makeDoc({
      settings: { ...makeDoc().settings, start: "2020-01-01", end: "2030-12-31", granularity: "month" },
    }),
    { ...baseOptions, mmPerDay: 2 },
  );
  const elapsed = Date.now() - started;
  check("very wide timeline terminates", elapsed < 4000, `${elapsed}ms, ${plan.totalPages} pages`);
  check("very wide timeline needs many pages", plan.totalPages > 20, `got ${plan.totalPages}`);
}

/* 6. Portrait is narrower than landscape, so it needs at least as many columns. */
{
  const landscape = planPages(makeDoc(), { ...baseOptions, mmPerDay: 1.5 });
  const portrait = planPages(makeDoc(), { ...baseOptions, mmPerDay: 1.5, orientation: "portrait" });
  check(
    "portrait needs at least as many columns as landscape",
    portrait.columns.length >= landscape.columns.length,
    `${portrait.columns.length} vs ${landscape.columns.length}`,
  );
}

/* 7. Dropping the lane-label column frees width, so pages cannot increase. */
{
  const withLabels = planPages(makeDoc(), { ...baseOptions, mmPerDay: 1.5 });
  const without = planPages(makeDoc(), { ...baseOptions, mmPerDay: 1.5, repeatLaneLabels: false });
  check(
    "dropping labels does not increase column count",
    without.columns.length <= withLabels.columns.length,
    `${without.columns.length} vs ${withLabels.columns.length}`,
  );
}

/* 8. Vertical scale. The presets only ever changed the horizontal scale, so a
 *    "detailed" export spread sideways but stayed just as cramped top to
 *    bottom. Scaling vertically has to actually change the plot's height. */
{
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `r${index}`,
    groupId: null,
    title: `Lane ${index}`,
  }));

  const normal = planPages(makeDoc({ rows }), baseOptions);
  const tall = planPages(makeDoc({ rows }), { ...baseOptions, verticalScale: 2.5 });
  const short = planPages(makeDoc({ rows }), { ...baseOptions, verticalScale: 0.5 });

  check("a larger vertical scale makes the plot taller", tall.plotHeight > normal.plotHeight * 2,
    `${short.plotHeight} / ${normal.plotHeight} / ${tall.plotHeight}`);
  check("a smaller vertical scale makes it shorter", short.plotHeight < normal.plotHeight);
  check("the vertical scale does not change the width", tall.plotWidth === normal.plotWidth);
  check("a taller plot needs at least as many pages down", tall.rows.length >= normal.rows.length,
    `${tall.rows.length} vs ${normal.rows.length}`);

  // Out-of-range values are clamped rather than producing a broken layout.
  const absurd = planPages(makeDoc({ rows }), { ...baseOptions, verticalScale: 99 });
  check("an absurd vertical scale is clamped", absurd.plotHeight <= normal.plotHeight * 4.01,
    `${absurd.plotHeight} vs ${normal.plotHeight}`);
}

/* 9. Custom horizontal scale drives the page count. */
{
  const wide = planPages(makeDoc(), { ...baseOptions, mmPerDay: 4 });
  const narrow = planPages(makeDoc(), { ...baseOptions, mmPerDay: 0.4 });
  check("a wider scale needs more pages across", wide.columns.length > narrow.columns.length,
    `${wide.columns.length} vs ${narrow.columns.length}`);
}

/* 10. The lane-name column sizes itself to the longest label. A fixed width
 *     simply cut off any name longer than the guess. */
{
  const short = planPages(makeDoc({ rows: [{ id: "r", groupId: null, title: "Ops" }] }), baseOptions);
  const long = planPages(
    makeDoc({
      rows: [{ id: "r", groupId: null, title: "Distribution network reinforcement programme" }],
    }),
    baseOptions,
  );

  check("a longer lane name widens the column", long.labelWidth > short.labelWidth,
    `${short.labelWidth.toFixed(1)} -> ${long.labelWidth.toFixed(1)}`);
  check("a short name still gets a minimum", short.labelWidth >= 22, String(short.labelWidth));
  check("a wider column leaves less room for the plot", long.plotWidth < short.plotWidth,
    `${long.plotWidth.toFixed(1)} vs ${short.plotWidth.toFixed(1)}`);

  // One absurd name must not consume the page.
  const absurd = planPages(
    makeDoc({ rows: [{ id: "r", groupId: null, title: "x".repeat(400) }] }),
    baseOptions,
  );
  const usable = 297 - 12 * 2; // A4 landscape width less margins
  check("an absurd name is capped", absurd.labelWidth <= usable * 0.46,
    `${absurd.labelWidth.toFixed(1)} of ${usable}`);

  // Group headings are bold and uppercase, so they count too.
  const grouped = planPages(
    makeDoc({
      groups: [{ id: "g", title: "Regulatory approvals and permitting", collapsed: false }],
      rows: [{ id: "r", groupId: "g", title: "Ops" }],
    }),
    baseOptions,
  );
  check("a long group heading widens the column", grouped.labelWidth > short.labelWidth,
    `${grouped.labelWidth.toFixed(1)}`);

  // A collapsed group's lanes are not drawn, so they must not widen anything.
  const collapsed = planPages(
    makeDoc({
      groups: [{ id: "g", title: "P", collapsed: true }],
      rows: [{ id: "r", groupId: "g", title: "A very long hidden lane name indeed" }],
    }),
    baseOptions,
  );
  check("hidden lanes do not widen the column", collapsed.labelWidth <= short.labelWidth + 0.01,
    `${collapsed.labelWidth.toFixed(1)} vs ${short.labelWidth.toFixed(1)}`);

  check("turning labels off removes the column",
    planPages(makeDoc(), { ...baseOptions, repeatLaneLabels: false }).labelWidth === 0);
}

console.log(failed === 0 ? "\nAll pagination checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
