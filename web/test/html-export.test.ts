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

const { buildHtml, buildSvg, pngSize } = await import("../src/features/export/html-export.ts");
type Doc = Parameters<typeof buildHtml>[0];

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failed++;
  }
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

/* 7. Cards that came from a note link back to it. */
{
  const sourced = buildHtml(
    {
      ...doc,
      groups: [],
      links: [],
      rows: [{ id: "r1", groupId: null, title: "Notes" }],
      items: [
        { id: "s1", rowId: "r1", kind: "bar", title: "From a note",
          color: 1, start: "2026-03-01", end: "2026-06-30", precision: "day",
          source: { kind: "obsidian", vault: "Vault", path: "notes/a.md",
            url: "obsidian://open?vault=Vault&file=notes%2Fa" } },
        { id: "s2", rowId: "r1", kind: "milestone", title: "A dated note",
          color: 2, start: "2026-08-01", end: "2026-08-01", precision: "day",
          source: { kind: "obsidian", vault: "Vault", path: "notes/b.md",
            url: "obsidian://open?vault=Vault&file=notes%2Fb" } },
        // A source with no url at all - the sync stores one, but a document
        // written by hand or by an older plugin may not have.
        { id: "s3", rowId: "r1", kind: "bar", title: "No way back",
          color: 4, start: "2026-11-01", end: "2026-11-30", precision: "day",
          source: { kind: "obsidian", vault: "Vault", path: "notes/c.md" } },
        { id: "s4", rowId: "r1", kind: "bar", title: "Hand-made",
          color: 3, start: "2026-09-01", end: "2026-10-31", precision: "day" },
      ],
    },
    { title: "T", theme: "midnight", showLaneLabels: true },
  );

  check("a source-backed card is wrapped in a link",
    sourced.includes(`<a class="cp-link" href="obsidian://open?vault=Vault&amp;file=notes%2Fa">`));
  check("the milestone form links too",
    sourced.includes(`<a class="cp-link" href="obsidian://open?vault=Vault&amp;file=notes%2Fb">`));
  check("only the two cards with a url are links",
    (sourced.match(/<a class="cp-link"/g) ?? []).length === 2,
    `${(sourced.match(/<a class="cp-link"/g) ?? []).length} link(s)`);
  check("a source without a url is left unwrapped", sourced.includes(`data-title="No way back"`));
  // A card with no source keeps its bare <g>: nothing was opened in front of it.
  const plain = sourced.indexOf(`<g class="cp-card" data-title="Hand-made"`);
  check("a card with no source is not a link",
    plain > 0 && !sourced.slice(plain - 40, plain).includes("cp-link"));
  check("every opened link is closed",
    (sourced.match(/<a class="cp-link"/g) ?? []).length === (sourced.match(/<\/a>/g) ?? []).length);
  check("obsidian links do not open a tab first",
    !/<a class="cp-link" href="obsidian:[^>]*target=/.test(sourced));
  check("a drag over a card cannot follow its link", sourced.includes("travelled > 6"));
  // The one place a scheme other than obsidian:// or https:// could appear is a
  // stored url, and the model refuses those - but the exporter is the last stop
  // before someone else's page, so assert it here as well.
  check("no javascript: url reaches the output", !/javascript:/i.test(sourced));

  const external = buildHtml(
    {
      ...doc,
      groups: [], links: [],
      rows: [{ id: "r1", groupId: null, title: "Notes" }],
      items: [
        { id: "s1", rowId: "r1", kind: "bar", title: "Published note",
          color: 1, start: "2026-03-01", end: "2026-06-30", precision: "day",
          source: { kind: "obsidian", vault: "Vault", path: "a.md",
            url: "https://notes.example.com/a" } },
      ],
    },
    { title: "T", theme: "midnight", showLaneLabels: true },
  );
  check("an https source opens in a new tab", external.includes(`target="_blank" rel="noopener"`));
  // Still self-contained: an anchor is followed on click, never fetched to render.
  check("the https link is only an anchor",
    !/(src)\s*=\s*["']https?:/i.test(external) && !/fetch\(|XMLHttpRequest/.test(external));
}

/* 8. A label the packer could place on neither side must still be drawn. */
{
  const widthOfSvg = (svg: string): number =>
    Number(/<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0);

  // One short bar at the very start of a ten-day timeline. A title this long
  // fits neither inside the bar nor to its left (there is nothing to the left),
  // so it goes right and runs off the end.
  const overhanging = (title: string): Doc => ({
    ...doc,
    settings: { ...doc.settings, start: "2026-01-01", end: "2026-01-10" },
    groups: [],
    links: [],
    rows: [{ id: "r1", groupId: null, title: "Lane" }],
    items: [
      { id: "i1", rowId: "r1", kind: "bar", title,
        color: 1, start: "2026-01-01", end: "2026-01-02", precision: "day" },
    ],
  });

  const short = buildSvg(overhanging("Short"), { title: "T", theme: "midnight", showLaneLabels: true });
  const long = buildSvg(overhanging("L".repeat(250)), { title: "T", theme: "midnight", showLaneLabels: true });

  check("a label running past the plot widens the canvas",
    widthOfSvg(long) > widthOfSvg(short), `${widthOfSvg(short)} -> ${widthOfSvg(long)}`);
  check("the overhanging label is in the output", long.includes("L".repeat(250)));

  // The drawing is shifted right by exactly the left overhang, so a label
  // reaching before the plot's zero is not clipped either.
  const leftOverhang = buildSvg(
    {
      ...doc,
      settings: { ...doc.settings, start: "2026-01-01", end: "2026-01-10" },
      groups: [], links: [],
      rows: [{ id: "r1", groupId: null, title: "Lane" }],
      items: [
        { id: "a", rowId: "r1", kind: "bar", title: "A".repeat(60),
          color: 1, start: "2026-01-08", end: "2026-01-09", precision: "day" },
      ],
    },
    { title: "T", theme: "midnight", showLaneLabels: true },
  );
  check("a left-hand label is kept inside the canvas", leftOverhang.includes("A".repeat(60)));
}

/* 9. Flat SVG and PNG sizing. */
{
  const opts = { title: "T", theme: "midnight" as const, showLaneLabels: true };

  const svg = buildSvg(doc, opts);
  check("buildSvg returns a standalone svg", svg.startsWith("<svg xmlns="));
  check("it carries its own styles", svg.includes("<style>") && svg.includes(".cp-outside"));
  check("it names a font, so rasterising is predictable", svg.includes("font-family"));
  check("it has no page chrome", !svg.includes("cp-stage") && !svg.includes("<script"));
  check("user text is still escaped", !svg.includes(`<script>alert("xss")</script>`));

  const opaque = buildSvg(doc, opts);
  const clear = buildSvg(doc, { ...opts, transparent: true });
  check("an opaque svg paints a background", /<rect width="\d+(\.\d+)?" height="\d+(\.\d+)?" fill=/.test(opaque));
  check("a transparent svg paints none",
    !/<rect width="\d+(\.\d+)?" height="\d+(\.\d+)?" fill=/.test(clear));
  check("transparency does not change the size",
    /width="(\d+(?:\.\d+)?)"/.exec(opaque)?.[1] === /width="(\d+(?:\.\d+)?)"/.exec(clear)?.[1]);

  const at1 = pngSize(doc, opts, 1);
  const at3 = pngSize(doc, opts, 3);
  check("png size scales with the multiplier",
    at3.width === at1.width * 3 && at3.height === at1.height * 3,
    `${at1.width}x${at1.height} -> ${at3.width}x${at3.height}`);
  check("png size is a whole number of pixels",
    Number.isInteger(at3.width) && Number.isInteger(at3.height));
}

/* 10. The interactive page honours transparency too. */
{
  const clear = buildHtml(doc, { title: "T", theme: "midnight", showLaneLabels: true, transparent: true });
  check("a transparent page leaves the body unpainted", /body\s*\{[^}]*background:\s*transparent/.test(clear));
  const opaque = buildHtml(doc, { title: "T", theme: "midnight", showLaneLabels: true });
  check("an opaque page still paints it", !/body\s*\{[^}]*background:\s*transparent/.test(opaque));
  check("the page keeps its interactivity either way", clear.includes('addEventListener("wheel"'));
}

console.log(failed === 0 ? "\nAll HTML export checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
