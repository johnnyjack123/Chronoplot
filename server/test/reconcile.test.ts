/*
 * Reconciling a document with an external source.
 * Run with:  npx tsx server/test/reconcile.test.ts
 *
 * This is the function that can lose work, so it gets tested directly rather
 * than only through the endpoint. The rule it must never break: items carrying
 * this source are owned by the source; items without one are never touched.
 */
import type { SyncRequest, TimelineDoc } from "../src/shared.js";
import { reconcile } from "../src/sync-source.js";

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failed++;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

const source = { kind: "obsidian" as const, vault: "Work" };

function baseDoc(overrides: Partial<TimelineDoc> = {}): TimelineDoc {
  return {
    schemaVersion: 1,
    settings: {
      start: "2026-01-01", end: "2026-12-31", granularity: "month", theme: "midnight",
      showToday: true, showWeekends: false, showLinks: true,
    },
    groups: [],
    rows: [{ id: "hand", groupId: null, title: "By hand" }],
    items: [
      {
        id: "manual", rowId: "hand", kind: "bar", title: "Drawn by a person",
        color: 5, start: "2026-02-01", end: "2026-03-31", precision: "day",
      },
    ],
    links: [],
    ...overrides,
  };
}

const request = (items: SyncRequest["items"], dryRun = false): SyncRequest => ({
  source, dryRun, items,
});

/* 1. A new note becomes a card, on a lane created for it. */
{
  const { doc, result } = reconcile(
    baseDoc(),
    request([
      { path: "a.md", title: "Platform", start: "2026-04-01", end: "2026-06-30",
        precision: "day", lane: "Engineering" },
    ]),
  );

  check("a new note is created", result.created === 1 && result.updated === 0);
  check("its lane is created", result.lanesCreated.includes("Engineering"));
  const item = doc.items.find((i) => i.source?.path === "a.md");
  check("the card records its source", item?.source?.vault === "Work", String(item?.source?.vault));
  check("it sits on the new lane", doc.rows.find((r) => r.id === item?.rowId)?.title === "Engineering");
  check("the hand-drawn card is untouched", doc.items.some((i) => i.id === "manual"));
}

/* 2. Re-syncing the same note updates rather than duplicating. */
{
  const first = reconcile(
    baseDoc(),
    request([{ path: "a.md", title: "Platform", start: "2026-04-01", end: "2026-06-30", precision: "day" }]),
  );
  const second = reconcile(
    first.doc,
    request([{ path: "a.md", title: "Platform, renamed", start: "2026-05-01", end: "2026-07-31", precision: "day" }]),
  );

  check("a known path updates", second.result.updated === 1 && second.result.created === 0);
  check("no duplicate appears", second.doc.items.filter((i) => i.source?.path === "a.md").length === 1);
  const item = second.doc.items.find((i) => i.source?.path === "a.md")!;
  check("the title follows the note", item.title === "Platform, renamed", item.title);
  check("the dates follow the note", item.start === "2026-05-01" && item.end === "2026-07-31");
}

/* 3. A colour set in Chronoplot survives a re-sync, because the note is silent
 *    about it. This is the whole point of only writing stated fields. */
{
  const first = reconcile(
    baseDoc(),
    request([{ path: "a.md", title: "Platform", start: "2026-04-01", end: "2026-06-30", precision: "day" }]),
  );
  const edited = structuredClone(first.doc);
  const target = edited.items.find((i) => i.source?.path === "a.md")!;
  target.color = 7;
  target.notes = "Added in the editor";

  const second = reconcile(
    edited,
    request([{ path: "a.md", title: "Platform", start: "2026-04-01", end: "2026-06-30", precision: "day" }]),
  );
  const after = second.doc.items.find((i) => i.source?.path === "a.md")!;
  check("a colour chosen in the editor survives", after.color === 7, String(after.color));
  check("notes added in the editor survive", after.notes === "Added in the editor");
}

/* 4. A note that disappears takes its card, and nothing else. */
{
  const first = reconcile(
    baseDoc(),
    request([
      { path: "a.md", title: "A", start: "2026-04-01", end: "2026-04-30", precision: "day" },
      { path: "b.md", title: "B", start: "2026-05-01", end: "2026-05-31", precision: "day" },
    ]),
  );
  const second = reconcile(
    first.doc,
    request([{ path: "a.md", title: "A", start: "2026-04-01", end: "2026-04-30", precision: "day" }]),
  );

  check("a vanished note is removed", second.result.removed === 1, String(second.result.removed));
  check("the remaining one stays", second.doc.items.some((i) => i.source?.path === "a.md"));
  check("the hand-drawn card still stays", second.doc.items.some((i) => i.id === "manual"));
  check("its lane is kept, not deleted", second.doc.rows.length === first.doc.rows.length);
}

/* 5. Another vault's items are not this vault's business. */
{
  const withOther = baseDoc();
  withOther.items.push({
    id: "other", rowId: "hand", kind: "bar", title: "From another vault",
    color: 2, start: "2026-06-01", end: "2026-06-30", precision: "day",
    source: { kind: "obsidian", vault: "Personal", path: "x.md" },
  });

  const { doc, result } = reconcile(withOther, request([]));
  check("an empty payload removes nothing of another vault", result.removed === 0);
  check("that item survives", doc.items.some((i) => i.id === "other"));
}

/* 6. Precision means whole units. */
{
  const { doc } = reconcile(
    baseDoc(),
    request([
      { path: "m.md", title: "A month", start: "2026-03-17", end: "2026-05-09", precision: "month" },
      { path: "y.md", title: "A year", start: "2026-07-04", end: "2027-02-02", precision: "year" },
    ]),
  );

  const month = doc.items.find((i) => i.source?.path === "m.md")!;
  check("a month start snaps to the first", month.start === "2026-03-01", month.start);
  check("a month end snaps to the last", month.end === "2026-05-31", month.end);

  const year = doc.items.find((i) => i.source?.path === "y.md")!;
  check("a year start snaps to January", year.start === "2026-01-01", year.start);
  check("a year end snaps to December", year.end === "2027-12-31", year.end);
}

/* 7. No end means a milestone. */
{
  const { doc } = reconcile(
    baseDoc(),
    request([{ path: "k.md", title: "Kickoff", start: "2026-04-01", precision: "day" }]),
  );
  const item = doc.items.find((i) => i.source?.path === "k.md")!;
  check("a note with no end is a milestone", item.kind === "milestone", item.kind);
  check("a milestone starts and ends the same day", item.start === item.end);
}

/* 8. Dates outside the window widen it rather than being clamped away. */
{
  const { doc } = reconcile(
    baseDoc(),
    request([{ path: "old.md", title: "Earlier", start: "2024-05-01", end: "2029-08-31", precision: "day" }]),
  );
  check("the window widens at the start", doc.settings.start === "2024-05-01", doc.settings.start);
  check("the window widens at the end", doc.settings.end === "2029-08-31", doc.settings.end);
}

/* 9. A dry run reports without changing anything. */
{
  const before = baseDoc();
  const snapshot = JSON.stringify(before);
  const { doc, result } = reconcile(
    before,
    request([{ path: "a.md", title: "A", start: "2026-04-01", end: "2026-04-30", precision: "day" }], true),
  );

  check("a dry run says so", result.dryRun === true);
  check("a dry run still reports the change", result.created === 1);
  check("the input document is not mutated", JSON.stringify(before) === snapshot);
  check("the returned document does hold the change", doc.items.length === before.items.length + 1);
}

/* 10. A duplicated path is reported, not applied twice. */
{
  const { doc, result } = reconcile(
    baseDoc(),
    request([
      { path: "a.md", title: "First", start: "2026-04-01", end: "2026-04-30", precision: "day" },
      { path: "a.md", title: "Second", start: "2026-05-01", end: "2026-05-31", precision: "day" },
    ]),
  );

  check("a duplicate path is warned about", result.warnings.length === 1, result.warnings[0] ?? "");
  check("only one card is created", doc.items.filter((i) => i.source?.path === "a.md").length === 1);
  check("the first entry wins", doc.items.find((i) => i.source?.path === "a.md")?.title === "First");
}

/* 11. Removing an item takes its links, or the document would not validate. */
{
  const first = reconcile(
    baseDoc(),
    request([
      { path: "a.md", title: "A", start: "2026-04-01", end: "2026-04-30", precision: "day" },
      { path: "b.md", title: "B", start: "2026-05-01", end: "2026-05-31", precision: "day" },
    ]),
  );
  const linked = structuredClone(first.doc);
  const [a, b] = linked.items.filter((i) => i.source);
  linked.links.push({ id: "l1", fromId: a!.id, toId: b!.id });

  const second = reconcile(
    linked,
    request([{ path: "a.md", title: "A", start: "2026-04-01", end: "2026-04-30", precision: "day" }]),
  );
  check("a link to a removed item goes with it", second.doc.links.length === 0, String(second.doc.links.length));
}

/* 12. A source that names no lane still lands somewhere sensible. */
{
  const { doc, result } = reconcile(
    baseDoc(),
    request([{ path: "a.md", title: "A", start: "2026-04-01", end: "2026-04-30", precision: "day" }]),
  );
  check("a lane named after the vault is created", result.lanesCreated.includes("Work"));
  const item = doc.items.find((i) => i.source?.path === "a.md")!;
  check("the card lands on it", doc.rows.find((r) => r.id === item.rowId)?.title === "Work");
}

/* 13. Lane matching is case-insensitive, so a note does not create a twin. */
{
  const doc = baseDoc();
  doc.rows.push({ id: "eng", groupId: null, title: "Engineering" });

  const { result } = reconcile(
    doc,
    request([{ path: "a.md", title: "A", start: "2026-04-01", end: "2026-04-30", precision: "day", lane: "engineering" }]),
  );
  check("an existing lane is reused regardless of case", result.lanesCreated.length === 0, result.lanesCreated.join(","));
}

console.log(failed === 0 ? "\nAll reconcile checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
