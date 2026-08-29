/*
 * Label placement, sub-lane packing and snapping.
 * Run with:  npx tsx --tsconfig web/tsconfig.json web/test/packing.test.ts
 *
 * The rule under test: a title that does not fit inside its bar is drawn beside
 * it, and that text occupies space. Ignoring it is what lets a label sit on top
 * of the next card.
 */
import type { Item, TimelineDoc } from "../../shared/src/index.ts";
import {
  layout as computeLayout, DEFAULT_LAYOUT, collectSnapTargets, snapOffsetDays,
} from "../src/features/timeline/geometry.ts";

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

function makeDoc(items: Partial<Item>[], settings: Partial<TimelineDoc["settings"]> = {}): TimelineDoc {
  return {
    schemaVersion: 1,
    settings: {
      start: "2026-01-01", end: "2026-12-31", granularity: "month", theme: "midnight",
      showToday: false, showWeekends: false, showLinks: true, ...settings,
    },
    groups: [],
    rows: [{ id: "r1", groupId: null, title: "Lane" }],
    items: items.map((item, index) => ({
      id: item.id ?? `i${index}`,
      rowId: "r1",
      kind: item.kind ?? "bar",
      title: item.title ?? "Item",
      color: 1,
      start: item.start ?? "2026-01-01",
      end: item.end ?? "2026-01-31",
      precision: "day",
      ...(item.progress !== undefined ? { progress: item.progress } : {}),
    })),
    links: [],
  };
}

const place = (doc: TimelineDoc, unitsPerDay = 3) =>
  computeLayout(doc, { ...DEFAULT_LAYOUT, unitsPerDay }).lanes[0]!;

/* 1. A short title in a wide bar stays inside. */
{
  const lane = place(makeDoc([{ title: "Go", start: "2026-02-01", end: "2026-06-30" }]));
  check("short title sits inside the bar", lane.items[0]!.labelSide === "inside", lane.items[0]!.labelSide);
}

/* 2. A long title on a narrow bar moves outside, to the right by default. */
{
  const lane = place(
    makeDoc([{ title: "A considerably longer card title", start: "2026-02-01", end: "2026-02-05" }]),
  );
  check("long title moves outside", lane.items[0]!.labelSide === "right", lane.items[0]!.labelSide);
  check("outside label reserves width", lane.items[0]!.labelWidth > 0, String(lane.items[0]!.labelWidth));
}

/* 3. A card near the end of the timeline labels to the left. */
{
  const lane = place(
    makeDoc([{ title: "A considerably longer card title", start: "2026-12-20", end: "2026-12-24" }]),
  );
  check("label flips left at the end of the timeline", lane.items[0]!.labelSide === "left", lane.items[0]!.labelSide);
}

/* 4. A right-hand label that would cover the next card flips left instead of
 *    pushing anything down. */
{
  const lane = place(
    makeDoc([
      { id: "a", title: "Long enough to overhang", start: "2026-03-01", end: "2026-03-04" },
      { id: "b", title: "Next", start: "2026-03-10", end: "2026-04-30" },
    ]),
  );
  const a = lane.items.find((entry) => entry.item.id === "a")!;
  const b = lane.items.find((entry) => entry.item.id === "b")!;
  check("crowded label flips to the left", a.labelSide === "left", a.labelSide);
  check("both cards stay on one sub-line", a.stack === 0 && b.stack === 0, `${a.stack}/${b.stack}`);
}

/* 5. When neither side is free, the card drops to a sub-line. */
{
  const lane = place(
    makeDoc([
      { id: "a", title: "First card with a long title", start: "2026-03-01", end: "2026-03-20" },
      { id: "b", title: "Second card with a long title", start: "2026-03-18", end: "2026-04-10" },
    ]),
  );
  const a = lane.items.find((entry) => entry.item.id === "a")!;
  const b = lane.items.find((entry) => entry.item.id === "b")!;
  check("overlapping cards use separate sub-lines", a.stack !== b.stack, `${a.stack}/${b.stack}`);
  check("the lane grew to hold both", lane.height > DEFAULT_LAYOUT.cardHeight * 1.5, String(lane.height));
}

/* 6. Two milestones a day apart must not sit on top of each other, even when a
 *    day is far narrower than the diamond. */
{
  const lane = place(
    makeDoc([
      { id: "m1", kind: "milestone", title: "One", start: "2026-05-01", end: "2026-05-01" },
      { id: "m2", kind: "milestone", title: "Two", start: "2026-05-02", end: "2026-05-02" },
    ]),
    0.5,
  );
  const m1 = lane.items.find((entry) => entry.item.id === "m1")!;
  const m2 = lane.items.find((entry) => entry.item.id === "m2")!;
  check("adjacent milestones separate", m1.stack !== m2.stack, `${m1.stack}/${m2.stack}`);
}

/* 7. Snapping. */
{
  const doc = makeDoc([
    { id: "a", title: "A", start: "2026-03-01", end: "2026-03-31" },
    { id: "b", title: "B", start: "2026-06-01", end: "2026-06-30" },
  ]);

  const targets = collectSnapTargets(doc, "b");
  check("targets include the other card's start", targets.includes("2026-03-01"));
  check("targets include the day after its end", targets.includes("2026-04-01"));
  check("the dragged card is excluded", !targets.includes("2026-06-01"));

  // Three days short of card A's trailing edge, at 3px/day, is 9px away.
  const nudge = snapOffsetDays(["2026-03-29"], targets, 3, 9);
  check("a near edge snaps", nudge === 3, String(nudge));

  // Far away, nothing should move.
  check("a distant edge does not snap", snapOffsetDays(["2026-05-01"], targets, 3, 9) === 0);

  // The same day distance is out of range once zoomed in.
  check(
    "snapping is measured in pixels, not days",
    snapOffsetDays(["2026-03-29"], targets, 30, 9) === 0,
  );
}

console.log(failed === 0 ? "\nAll packing checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
