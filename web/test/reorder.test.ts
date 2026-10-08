/*
 * Lane and group reordering.
 * Run with:  npx tsx --tsconfig web/tsconfig.json web/test/reorder.test.ts
 *
 * The subtlety worth testing: the rendered order is "ungrouped lanes first,
 * then each group's lanes", both in array order - so an array index is not a
 * screen position. These checks assert against the *rendered* order, computed
 * by the same layout code the canvas uses.
 */
import type { TimelineDoc } from "../../shared/src/index.ts";
import { commands, useEditorStore } from "../src/state/editor-store.ts";
import { layout as computeLayout, DEFAULT_LAYOUT } from "../src/features/timeline/geometry.ts";

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failed++;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

function baseDoc(): TimelineDoc {
  return {
    schemaVersion: 1,
    settings: {
      start: "2026-01-01", end: "2026-12-31", granularity: "month", theme: "midnight",
      showToday: true, showWeekends: false, showLinks: true,
    },
    groups: [
      { id: "gA", title: "Alpha", collapsed: false },
      { id: "gB", title: "Beta", collapsed: false },
    ],
    rows: [
      { id: "r1", groupId: null, title: "Free 1" },
      { id: "r2", groupId: null, title: "Free 2" },
      { id: "a1", groupId: "gA", title: "Alpha 1" },
      { id: "a2", groupId: "gA", title: "Alpha 2" },
      { id: "b1", groupId: "gB", title: "Beta 1" },
    ],
    items: [
      { id: "i1", rowId: "a2", kind: "bar", title: "Task", color: 1,
        start: "2026-03-01", end: "2026-04-30", precision: "day" },
    ],
    links: [],
  };
}

function load(): void {
  useEditorStore.getState().load({
    projectId: "p", title: "T", doc: baseDoc(), version: 1, role: "owner",
  });
}

/** Rendered lane order, straight from the layout engine. */
function renderedLanes(): string[] {
  const doc = useEditorStore.getState().doc!;
  return computeLayout(doc, DEFAULT_LAYOUT).lanes.map((lane) => lane.rowId);
}

const renderedGroups = (): string[] =>
  computeLayout(useEditorStore.getState().doc!, DEFAULT_LAYOUT).groups.map((g) => g.groupId);

const groupOf = (rowId: string): string | null =>
  useEditorStore.getState().doc!.rows.find((r) => r.id === rowId)?.groupId ?? null;

/* 1. Baseline. */
{
  load();
  check(
    "renders ungrouped lanes first, then groups in order",
    renderedLanes().join(",") === "r1,r2,a1,a2,b1",
    renderedLanes().join(","),
  );
}

/* 2. Reorder within the ungrouped section. */
{
  load();
  commands.reorderRow("r2", null, "r1");
  check("moves a lane up among ungrouped", renderedLanes().join(",") === "r2,r1,a1,a2,b1", renderedLanes().join(","));
}

/* 3. Move a lane into a group, in the middle. */
{
  load();
  commands.reorderRow("r1", "gA", "a2");
  check("moves a lane into a group", renderedLanes().join(",") === "r2,a1,r1,a2,b1", renderedLanes().join(","));
  check("the lane records its new group", groupOf("r1") === "gA", String(groupOf("r1")));
}

/* 4. Move a lane out of a group back to the top level. */
{
  load();
  commands.reorderRow("a1", null, "r2");
  check("moves a lane out of a group", renderedLanes().join(",") === "r1,a1,r2,a2,b1", renderedLanes().join(","));
  check("the lane is ungrouped again", groupOf("a1") === null, String(groupOf("a1")));
}

/* 5. Append to the end of a group. */
{
  load();
  commands.reorderRow("r1", "gB", null);
  check("appends to the end of a group", renderedLanes().join(",") === "r2,a1,a2,b1,r1", renderedLanes().join(","));
}

/* 6. Moving a lane onto itself changes nothing. */
{
  load();
  const before = renderedLanes().join(",");
  commands.reorderRow("a1", "gA", "a1");
  check("a no-op move leaves the order alone", renderedLanes().join(",") === before, renderedLanes().join(","));
}

/* 7. Cards stay attached to their lane. */
{
  load();
  commands.reorderRow("a2", null, "r1");
  const item = useEditorStore.getState().doc!.items[0]!;
  check("a card follows its lane", item.rowId === "a2");
  const laneWithItem = computeLayout(useEditorStore.getState().doc!, DEFAULT_LAYOUT)
    .lanes.find((lane) => lane.items.length > 0);
  check("the card renders on the moved lane", laneWithItem?.rowId === "a2", String(laneWithItem?.rowId));
}

/* 8. Group reordering. */
{
  load();
  commands.reorderGroup("gB", "gA");
  check("moves a group before another", renderedGroups().join(",") === "gB,gA", renderedGroups().join(","));
  check(
    "lanes follow their group",
    renderedLanes().join(",") === "r1,r2,b1,a1,a2",
    renderedLanes().join(","),
  );
}

/* 9. Group to the end. */
{
  load();
  commands.reorderGroup("gA", null);
  check("moves a group to the end", renderedGroups().join(",") === "gB,gA", renderedGroups().join(","));
}

/* 10. Undo restores the previous order. */
{
  load();
  const before = renderedLanes().join(",");
  commands.reorderRow("r1", "gA", "a1");
  check("the move took effect", renderedLanes().join(",") !== before);
  useEditorStore.getState().undo();
  check("undo restores the order", renderedLanes().join(",") === before, renderedLanes().join(","));
  check("undo restores the grouping", groupOf("r1") === null, String(groupOf("r1")));
}

/* 11. Read-only access cannot reorder. */
{
  useEditorStore.getState().load({
    projectId: "p", title: "T", doc: baseDoc(), version: 1, role: "viewer",
  });
  const before = renderedLanes().join(",");
  commands.reorderRow("r1", "gA", "a1");
  check("a viewer cannot reorder", renderedLanes().join(",") === before, renderedLanes().join(","));
}

/* 12. A move into a group that does not exist is refused rather than applied. */
{
  load();
  const before = renderedLanes().join(",");
  commands.reorderRow("r1", "missing-group", null);
  check("an unknown group is refused", renderedLanes().join(",") === before, renderedLanes().join(","));
  check("the lane keeps its group", groupOf("r1") === null, String(groupOf("r1")));
}

console.log(failed === 0 ? "\nAll reorder checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
