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
  layout as computeLayout, DEFAULT_LAYOUT, canRemoveSubLane, collectSnapTargets, snapOffsetDays,
} from "../src/features/timeline/geometry.ts";
import { roundedPath } from "../src/features/timeline/Links.tsx";

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failed++;
  }
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
      ...(item.subLane !== undefined ? { subLane: item.subLane } : {}),
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
  const near = snapOffsetDays(["2026-03-29"], targets, 3, 9);
  check("a near edge snaps", near.days === 3, String(near.days));
  check("the snap reports what it caught on", near.target === "2026-04-01", String(near.target));

  // Far away, nothing should move.
  const far = snapOffsetDays(["2026-05-01"], targets, 3, 9);
  check("a distant edge does not snap", far.days === 0 && far.target === null);

  // The same day distance is out of range once zoomed in.
  const zoomed = snapOffsetDays(["2026-03-29"], targets, 30, 9);
  check("snapping is measured in pixels, not days", zoomed.days === 0 && zoomed.target === null);
}

/* 8. Rounded link routing. The path must still pass through the same corners -
 *    rounding is a finish, not a different route. */
{
  const square = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], 0);
  check("a zero radius stays a polyline", !square.includes("Q"), square);

  const curved = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], 8);
  check("corners become curves", curved.includes("Q"), curved);
  check("the route still starts where it should", curved.startsWith("M 0 0"), curved.slice(0, 12));
  check("the route still ends where it should", curved.trimEnd().endsWith("100 50"), curved.slice(-14));

  // A corner between two short segments must not round further than half of
  // either, or the curve overshoots and doubles back.
  const tight = roundedPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 20);
  const numbers = tight.match(/-?\d+(\.\d+)?/g)!.map(Number);
  check("a tight corner does not overshoot", numbers.every((n) => n >= -0.01 && n <= 4.01), tight);

  check("a single point is harmless", roundedPath([{ x: 3, y: 4 }]) === "M 3 4");
  check("an empty route is harmless", roundedPath([]) === "");
}

/* ------------------------------------------------------------- sub-lanes -- */

const byId = (lane: ReturnType<typeof place>, id: string) =>
  lane.items.find((placed) => placed.item.id === id)!;

/* A pinned card goes exactly where it says, even with the lane empty. */
{
  const lane = place(makeDoc([{ id: "a", start: "2026-02-01", end: "2026-02-20", subLane: 2 }]));
  check("a pinned card takes its sub-lane", byId(lane, "a").stack === 2, String(byId(lane, "a").stack));
  check("it is marked as pinned", byId(lane, "a").pinned);
  check("the lane grows to hold it", lane.subLanes >= 3, String(lane.subLanes));
  check("a pinned card sits lower than sub-lane 0", byId(lane, "a").y > lane.y);
}

/* An unpinned card keeps arranging itself, and does so around the pinned one. */
{
  const lane = place(
    makeDoc([
      // Same dates, so they would collide if both were free to choose.
      { id: "pinned", start: "2026-03-01", end: "2026-05-31", subLane: 0 },
      { id: "loose", start: "2026-03-01", end: "2026-05-31" },
    ]),
  );
  check("the pinned card held sub-lane 0", byId(lane, "pinned").stack === 0);
  check("the loose card moved out of its way", byId(lane, "loose").stack !== 0,
    String(byId(lane, "loose").stack));
  check("the loose card is not marked pinned", !byId(lane, "loose").pinned);
}

/* Free space between pinned cards is usable, which a single rightmost mark
   could not express. */
{
  const lane = place(
    makeDoc([
      { id: "early", start: "2026-01-01", end: "2026-01-20", subLane: 0 },
      { id: "late", start: "2026-11-01", end: "2026-11-20", subLane: 0 },
      // Fits comfortably in the gap between them.
      { id: "middle", title: "M", start: "2026-05-01", end: "2026-05-20" },
    ]),
  );
  check("a loose card uses the gap between two pinned ones",
    byId(lane, "middle").stack === 0, String(byId(lane, "middle").stack));
}

/* Pinning two overlapping cards to one sub-lane is honoured rather than
   silently undone - the alternative is moving a card the user placed. */
{
  const lane = place(
    makeDoc([
      { id: "x", start: "2026-03-01", end: "2026-06-30", subLane: 1 },
      { id: "y", start: "2026-04-01", end: "2026-07-31", subLane: 1 },
    ]),
  );
  check("both pins are respected",
    byId(lane, "x").stack === 1 && byId(lane, "y").stack === 1);
}

/* A lane can keep an empty sub-lane, which is what makes it a drop target. */
{
  const doc = makeDoc([{ id: "a", start: "2026-02-01", end: "2026-02-20" }]);
  doc.rows[0]!.subLanes = 3;
  const lane = place(doc);
  check("an empty sub-lane is kept", lane.subLanes === 3, String(lane.subLanes));
  check("the lane is tall enough for it",
    lane.height > DEFAULT_LAYOUT.lanePadding * 2 + DEFAULT_LAYOUT.cardHeight * 2);
  check("the card itself still packs to the top", byId(lane, "a").stack === 0);
}

/* Documents written before sub-lanes existed behave exactly as they did. */
{
  const lane = place(
    makeDoc([
      { id: "a", title: "A long enough title to be pushed outside", start: "2026-02-01", end: "2026-02-05" },
      { id: "b", title: "Another long title that cannot share the line", start: "2026-02-06", end: "2026-02-10" },
    ]),
  );
  check("nothing is pinned by default", lane.items.every((placed) => !placed.pinned));
  check("overlapping labels still split onto sub-lanes", lane.subLanes > 1, String(lane.subLanes));
}

/* ------------------------------------------------- collapsing back down -- */

/*
 * The reported bug. Pinning a card to sub-lane 1 and bringing it back to 0
 * must leave the lane exactly as it was. It did not: the pin was recorded on
 * the row as well, and that copy never went away, so the lane kept an empty
 * sub-lane and stayed tall.
 */
{
  const plain = place(makeDoc([{ id: "a", start: "2026-03-01", end: "2026-04-30" }]));
  const returned = place(makeDoc([{ id: "a", start: "2026-03-01", end: "2026-04-30", subLane: 0 }]));

  check("a card pinned back to the top collapses the lane",
    returned.subLanes === 1, String(returned.subLanes));
  check("and the lane is the height it started at",
    returned.height === plain.height, `${returned.height} vs ${plain.height}`);
  check("and the card is back at the top", byId(returned, "a").y === byId(plain, "a").y);
}

/* An explicitly added sub-lane is the one thing that must survive. */
{
  const doc = makeDoc([{ id: "a", start: "2026-03-01", end: "2026-04-30", subLane: 0 }]);
  doc.rows[0]!.subLanes = 2;
  const lane = place(doc);
  check("a deliberately added sub-lane is kept when the card returns",
    lane.subLanes === 2, String(lane.subLanes));
}

/* --------------------------------------- labels push cards down as bars -- */

/*
 * The question this has to answer: a bar too short for its title has the title
 * drawn beside it, and that text occupies space exactly as the bar does. A card
 * sitting under that text is in the way just as much as one under the bar.
 */
{
  const lane = place(
    makeDoc([
      // Fills the left, so the long title below has no free side to flip to.
      // Without this the packer simply draws it leftwards and no card has to
      // move at all - which is the better outcome, and not the case under test.
      { id: "blocker", title: "Blocker", start: "2026-01-01", end: "2026-04-30", subLane: 0 },
      { id: "pinned", title: "A title much too long to fit inside its own bar", start: "2026-05-05", end: "2026-05-09", subLane: 0 },
      // Starts after the pinned bar ends, but underneath where its title lands.
      { id: "loose", title: "L", start: "2026-06-15", end: "2026-06-25" },
    ]),
  );
  const pinned = byId(lane, "pinned");
  check("(premise) the pinned card's title is drawn to the right",
    pinned.labelSide === "right", pinned.labelSide);
  check("(premise) that title reaches over the loose card",
    pinned.x + pinned.width + pinned.labelWidth > byId(lane, "loose").x,
    `${Math.round(pinned.x + pinned.width + pinned.labelWidth)} vs ${Math.round(byId(lane, "loose").x)}`);
  check("a card is pushed down by a label, not just by a bar",
    byId(lane, "loose").stack === 1, String(byId(lane, "loose").stack));
}

/* The same rule the other way round: the loose card's own label counts too. */
{
  const lane = place(
    makeDoc([
      { id: "early", title: "E", start: "2026-02-20", end: "2026-02-24", subLane: 0 },
      { id: "late", title: "A title far too long for this short bar", start: "2026-02-26", end: "2026-03-01" },
    ]),
  );
  const late = byId(lane, "late");
  // Either it moved down, or it put its label on the free side - both are
  // correct, and both mean the label was taken into account.
  check("a long title is never drawn straight over its neighbour",
    late.stack === 1 || late.labelSide === "right",
    `stack ${late.stack}, label ${late.labelSide}`);
}

/* ------------------------------------------- removing the last sub-lane -- */

/* Room above, so the row can collapse. */
{
  const doc = makeDoc([
    { id: "top", start: "2026-01-01", end: "2026-02-28", subLane: 0 },
    // Nowhere near the one above, so moving it up is free.
    { id: "bottom", start: "2026-09-01", end: "2026-10-31", subLane: 1 },
  ]);
  check("removable when the sub-lane above has room",
    canRemoveSubLane(place(doc), DEFAULT_LAYOUT));
}

/* Nothing above it at all. */
{
  const doc = makeDoc([{ id: "only", start: "2026-03-01", end: "2026-04-30", subLane: 1 }]);
  check("removable when the sub-lane above is empty",
    canRemoveSubLane(place(doc), DEFAULT_LAYOUT));
}

/* The reported bug: overlapping cards, so the row cannot collapse. */
{
  const doc = makeDoc([
    { id: "top", start: "2026-03-01", end: "2026-08-31", subLane: 0 },
    { id: "bottom", start: "2026-04-01", end: "2026-09-30", subLane: 1 },
  ]);
  check("NOT removable when the cards would collide",
    !canRemoveSubLane(place(doc), DEFAULT_LAYOUT));
}

/* A single sub-lane has nothing to remove. */
{
  const doc = makeDoc([{ id: "a", start: "2026-03-01", end: "2026-04-30" }]);
  check("NOT removable when there is only one sub-lane",
    !canRemoveSubLane(place(doc), DEFAULT_LAYOUT));
}

/*
 * Labels count, not just bars. Getting a label to sit on the right needs the
 * left blocked - otherwise the packer sends it left, where it collides with
 * nothing and the lane collapses perfectly well. So: a card occupying the left,
 * the long-titled card next to it, and something under where its title lands.
 */
{
  const doc = makeDoc([
    { id: "blocker", title: "Blocker", start: "2026-01-01", end: "2026-04-30", subLane: 0 },
    { id: "top", title: "A title far too long to fit inside this bar", start: "2026-05-05", end: "2026-05-10", subLane: 0 },
    { id: "bottom", title: "B", start: "2026-06-10", end: "2026-06-20", subLane: 1 },
  ]);
  const lane = place(doc);
  const top = byId(lane, "top");

  // State the premise, so a packer change reports itself rather than quietly
  // turning this into a test of nothing.
  check("(premise) the long title sits to the right", top.labelSide === "right", top.labelSide);
  check("(premise) its label reaches over the card below",
    top.x + top.width + top.labelWidth > byId(lane, "bottom").x,
    `${Math.round(top.x + top.width + top.labelWidth)} vs ${Math.round(byId(lane, "bottom").x)}`);

  check("NOT removable when only the label would collide",
    !canRemoveSubLane(lane, DEFAULT_LAYOUT));
}

console.log(failed === 0 ? "\nAll packing checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
