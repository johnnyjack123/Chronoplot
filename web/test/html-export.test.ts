/*
 * Standalone HTML export.
 * Run with:  npx tsx --tsconfig web/tsconfig.json web/test/html-export.test.ts
 *
 * Two things matter here beyond "it produced output". The file must be genuinely
 * self-contained, or it breaks the moment it is opened offline or embedded in a
 * page with a strict content policy. And every piece of user text must be
 * escaped: card titles are user input, and the result is HTML meant to be
 * embedded in someone else's page.
 */

/* A DOM small enough to satisfy the palette probe, so this runs without a
 * browser. Colours fall back to the built-in defaults, which is fine - the
 * point is the structure and the escaping, not the exact hex values. */
const stubElement = () => ({
  style: { cssText: "" },
  setAttribute: () => undefined,
  remove: () => undefined,
});
(globalThis as Record<string, unknown>).document = {
  createElement: stubElement,
  body: { appendChild: () => undefined },
};
(globalThis as Record<string, unknown>).getComputedStyle = () => ({ getPropertyValue: () => "" });

const { buildHtml } = await import("../src/features/export/html-export.ts");
type Doc = Parameters<typeof buildHtml>[0];

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

const doc: Doc = {
  schemaVersion: 1,
  settings: {
    start: "2026-01-01", end: "2026-12-31", granularity: "month", theme: "midnight",
    showToday: true, showWeekends: false, showLinks: true,
  },
  groups: [{ id: "g1", title: "Phase one", collapsed: false }],
  rows: [
    { id: "r1", groupId: null, title: "Milestones" },
    { id: "r2", groupId: "g1", title: "Build" },
  ],
  items: [
    { id: "i1", rowId: "r1", kind: "milestone", title: "Kickoff",
      color: 3, start: "2026-02-02", end: "2026-02-02", precision: "day" },
    { id: "i2", rowId: "r2", kind: "bar", title: "Platform work",
      color: 1, start: "2026-03-01", end: "2026-07-31", precision: "day", progress: 0.4 },
    // Deliberately hostile: this must never come back as live markup.
    { id: "i3", rowId: "r2", kind: "bar", title: `</text><script>alert("xss")</script>`,
      color: 5, start: "2026-08-01", end: "2026-09-30", precision: "day" },
  ],
  links: [{ id: "l1", fromId: "i2", toId: "i3" }],
};

const html = buildHtml(doc, { title: `Roadmap <img src=x onerror="alert(1)">`, theme: "midnight", showLaneLabels: true });

/* 1. Shape. */
check("starts with a doctype", html.startsWith("<!doctype html>"));
check("contains an svg drawing", html.includes("<svg"));
check("is a reasonable size", html.length > 3000, `${html.length} bytes`);

/* 2. Self-contained: nothing may be fetched at view time. */
check("no external http references", !/(src|href)\s*=\s*["']https?:/i.test(html));
check("no protocol-relative references", !/(src|href)\s*=\s*["']\/\//i.test(html));
check("no @import", !html.includes("@import"));
check("no fetch or XHR", !/\bfetch\(|XMLHttpRequest/.test(html));

/* 3. Escaping - the security-relevant part. */
const injected = `<script>alert("xss")</script>`;
check("injected script tag is not present verbatim", !html.includes(injected));
check("injected markup is escaped", html.includes("&lt;/text&gt;&lt;script&gt;"));
// The injected <img> must survive only as text. Its characters are still in the
// file - "onerror=" and all - which is exactly right; what matters is that no
// tag was ever opened.
check("the injected img tag is escaped", html.includes("&lt;img src=x"));
check("no img element is emitted", !/<img[\s>]/i.test(html));
// The document's own script uses addEventListener, so any inline handler in the
// output could only have come from user text that escaped.
check("no inline event attributes at all", !/\son[a-z]+\s*=\s*["']/i.test(html));

/* 4. Content actually made it in. */
check("lane names are present", html.includes("Milestones") && html.includes("Build"));
check("group name is present", html.includes("PHASE ONE"));
check("a card title is present", html.includes("Platform work"));
check("hover ranges are attached to cards", html.includes('data-range="'));
check("the milestone renders", html.includes("Kickoff"));
check("the dependency arrow renders", html.includes("marker-end=\"url(#cp-arrow)\""));
check("the today marker renders", html.includes("cp-arrow") && html.split("<line").length > 3);

/* 5. Interactivity is wired up. */
for (const hook of ["cp-stage", "cp-surface", "cp-tip", "cp-fit", "cp-in", "cp-out"]) {
  check(`element ${hook} exists`, html.includes(`id="${hook}"`));
}
check("wheel zoom is registered", html.includes('addEventListener("wheel"'));
check("pan is registered", html.includes('addEventListener("pointerdown"'));

/* 5b. The lane column grows with the longest label rather than clipping it. */
{
  const wide = buildHtml(
    {
      ...doc,
      rows: [{ id: "r1", groupId: null, title: "Distribution network reinforcement programme" }],
      items: [],
      groups: [],
      links: [],
    },
    { title: "T", theme: "midnight", showLaneLabels: true },
  );
  const narrow = buildHtml(
    { ...doc, rows: [{ id: "r1", groupId: null, title: "Ops" }], items: [], groups: [], links: [] },
    { title: "T", theme: "midnight", showLaneLabels: true },
  );

  const widthOf = (html: string): number => Number(/<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(html)?.[1] ?? 0);
  check("a long lane name widens the drawing", widthOf(wide) > widthOf(narrow),
    `${widthOf(narrow)} -> ${widthOf(wide)}`);
  check("the long name is present in full", wide.includes("Distribution network reinforcement programme"));
}

/* 6. Turning lane labels off removes them. */
{
  const bare = buildHtml(doc, { title: "T", theme: "daylight", showLaneLabels: false });
  check("lane names can be omitted", !bare.includes(">Milestones<"));
  check("cards survive without lane names", bare.includes("Platform work"));
}

console.log(failed === 0 ? "\nAll HTML export checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
