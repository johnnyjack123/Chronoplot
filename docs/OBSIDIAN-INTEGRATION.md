# Obsidian integration — concept

A plan for an Obsidian plugin that turns dated notes into Chronoplot cards, and
for the Chronoplot changes it needs. Written to be picked up cold: everything
below is a decision or an open question, not a summary of a conversation.

**Status:** built. Phases 1–4 are in the tree; §9 records what was decided and
§10 says where each piece lives. Phase 5 is still open.

One departure from the plan below: the plugin lives in this repository at
`obsidian-plugin/`, not in a separate one. It is deliberately *outside* the npm
workspaces — it builds against Obsidian's API and has nothing to say to the
server's dependency tree — so it has its own `npm install` and its own build.

---

## 1. Orientation — what already exists

Read these before changing anything.

| Where | What it is |
|---|---|
| `shared/src/index.ts` | The timeline document model and its Zod schemas. Both server and browser import it. Optional fields are how the model has been extended so far (`row.color`, `item.progress`) — old documents stay valid. |
| `server/src/routes/projects.ts` | Project CRUD. `loadAccess` resolves the caller's role before every read or write; nothing bypasses it. Saving uses `baseVersion` and returns 409 on a mismatch. |
| `server/src/auth/` | Session cookies: argon2id, opaque tokens stored as SHA-256, origin check plus double-submit CSRF. |
| `server/src/db/schema.ts` | Migrations run on boot and are written to be safe to repeat (`hasColumn`). Rehearse with `scripts/check-migration.mjs`. |
| `web/src/features/timeline/geometry.ts` | All layout maths. Screen, PDF and HTML all render from it. |
| `web/src/features/export/html-export.ts` | Standalone HTML, escapes every piece of user text. |

Two habits worth keeping: **the document is the source of truth** (the editor
derives everything from it, including the theme), and **new document fields are
optional** so existing projects keep validating.

---

## 2. What this integration is

A note that says when something happens becomes a card on a Chronoplot timeline.
Which notes, and which timeline, is configured in the plugin. Clicking the card
takes you back to the note.

**One direction only: Obsidian → Chronoplot.** Two-way sync would mean deciding
who wins when both change, and that question has no good answer for prose. Notes
own their dates; Chronoplot owns everything else about presentation.

**Out of scope for the first version:** editing notes from Chronoplot, syncing
note bodies, Dataview-style queries as a selection mechanism, and any live
connection. Sync is an explicit or scheduled push.

---

## 3. The frontmatter contract

Two flat properties, with a configurable prefix (default `chronoplot`):

```yaml
---
chronoplot-start: "01.03.2026"
chronoplot-end: "30.09.2026"
chronoplot-title: Platform migration     # optional, defaults to the note name
chronoplot-lane: Engineering             # optional, see §4
chronoplot-color: 3                      # optional, palette slot 0-8
chronoplot-kind: bar                     # optional: bar | milestone
---
```

Flat keys rather than a nested object: Obsidian's Properties editor handles them
properly, and they sort and query cleanly in Dataview.

A note with no start property is ignored. A note with a start and no end is a
**milestone**.

### Accepted date forms

| Written | Means | Chronoplot precision |
|---|---|---|
| `01.03.2026` or `01032026` | 1 March 2026 | `day` |
| `03.2026` or `032026` | March 2026 | `month` |
| `2026` | the year 2026 | `year` |
| `2026-03-01` | 1 March 2026 | `day` |

The precision falls straight out of the form, and Chronoplot already snaps
month- and year-precision items to whole units — a `03.2026` start becomes 1
March and a `03.2026` end becomes 31 March, with no extra work.

### The trap that will bite: YAML eats leading zeros

`chronoplot-start: 01032026` unquoted is parsed as a **number**, and the leading
zero is dropped: the plugin receives `1032026`. The first of the month silently
becomes garbage, and nothing looks wrong in the note.

Three things follow, and all three are required:

1. **Document quoting.** The recommended form is dotted and quoted:
   `"01.03.2026"`. Dots make it a string in every YAML parser.
2. **Recover in the plugin.** When the value arrives as a number, zero-pad it to
   the nearest valid length — 7 digits → 8, 5 → 6, 3 → 4 — because the valid
   lengths are known. `1032026` → `01032026` → 1 March 2026.
3. **Warn anyway.** Even when recovery succeeds, report it, so the note gets
   fixed rather than relying on the guess forever.

An unrecoverable value (wrong length, impossible date, end before start) is
reported per note and that note is skipped. It never fails the whole sync.

---

## 4. Choosing which notes go where

Plugin settings hold a list of **bindings**. Each binding maps a set of paths to
one Chronoplot project:

```ts
interface Binding {
  projectId: string;       // from the Chronoplot instance
  projectTitle: string;    // cached, for display only
  include: string[];       // vault-relative; a folder includes everything under it
  exclude: string[];       // wins over include
  laneStrategy: "property" | "folder" | "fixed";
  defaultLane: string;     // used by "fixed", and as a fallback
}
```

- A path that names a **file** includes exactly that file.
- A path that names a **folder** includes it recursively.
- `exclude` always wins, so a folder can be included with holes in it.
- A note matched by more than one binding goes to **all** of them. That is a
  feature (one milestone on two roadmaps), but the settings screen should say
  so, because otherwise it looks like a bug.

**Lane assignment**, in precedence order: the `chronoplot-lane` property, then
(if the strategy is `folder`) the note's parent folder name, then the binding's
default lane. Lanes named by a sync are created if missing and never deleted —
removing the last note from a lane leaves an empty lane, which is far less
alarming than a lane silently disappearing.

---

## 5. Authentication: API tokens

Session cookies are useless here — the plugin is not a browser. Chronoplot needs
**personal access tokens**.

| Decision | Choice |
|---|---|
| Format | 32 random bytes, base64url, prefixed `cpt_` so it is recognisable in logs and greppable if leaked |
| Storage | SHA-256 only, exactly like sessions — a database leak must not yield working tokens |
| Display | Once, at creation. Never retrievable afterwards |
| Metadata | Name, created-at, last-used-at, optional expiry |
| Scope | Optional single project. Recommended for plugin use |
| Transport | `Authorization: Bearer cpt_…` |
| CSRF | Not applicable: CSRF defends ambient credentials, and a bearer token is not ambient. **Verified** — the hook in `server/src/auth/plugin.ts` returns early on `if (!request.sessionToken) return;`, so a bearer-only request never reaches it |
| Rate limit | Tighter than the session API |

New table:

```sql
CREATE TABLE api_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- null = all
  created_at  <ts> NOT NULL,
  last_used_at <ts>,
  expires_at  <ts>
);
```

A token inherits its owner's permissions and can never exceed them — resolve it
to a user and run the existing `loadAccess` unchanged.

> **Implementation trap:** bearer auth must set `request.user` but leave
> `request.sessionToken` alone. Setting it would drag every token request into
> the CSRF hook, which then demands a cookie and a matching header the plugin
> has no way to produce — a 403 whose cause is nowhere near where it is raised.

> **Caveat worth stating in the plugin UI:** Obsidian stores plugin settings in
> plain JSON inside the vault (`.obsidian/plugins/…/data.json`). If the vault is
> synced or in version control, the token goes with it. This is the strongest
> argument for project-scoped tokens with an expiry.

---

## 6. The sync protocol

### Marking items as externally owned

Extend the item schema with an optional `source`:

```ts
source: z.object({
  kind: z.literal("obsidian"),
  vault: z.string().max(200),
  path: z.string().max(1000),     // vault-relative, also the external id
  url: z.string().max(2000).optional(),
}).optional()
```

Optional, so every existing document stays valid.

This is what lets a sync replace its own cards without touching anything a
person made by hand. Without it, sync would have to either wipe the project or
guess.

### Endpoint

```
POST /api/projects/:id/sync
Authorization: Bearer cpt_…

{
  "source":  { "kind": "obsidian", "vault": "Work" },
  "dryRun":  false,
  "items": [
    {
      "path": "Projects/Platform.md",
      "title": "Platform migration",
      "start": "2026-03-01",
      "end":   "2026-09-30",
      "precision": "day",
      "kind": "bar",
      "lane": "Engineering",
      "color": 3,
      "url": "obsidian://open?vault=Work&file=Projects%2FPlatform"
    }
  ]
}
```

Server behaviour, all inside one transaction:

1. Load the document.
2. **Match** existing items by `source.kind + source.vault + source.path`.
3. **Update** matches: dates, precision, kind, title. Fields the payload omits
   (colour, lane) keep whatever the project has — so a colour chosen in
   Chronoplot survives a re-sync.
4. **Create** items for paths not present.
5. **Delete** items from this source whose path is no longer in the payload.
   Never touch items with no `source`, or a different vault.
6. Create any missing lanes by name.
7. Bump `version` and save.

Response: `{ created, updated, removed, warnings[], version }`.

Two decisions worth being explicit about:

- **No `baseVersion` from the plugin.** It does not hold the document, so it
  cannot supply one. The read-modify-write happens server-side under a
  transaction. An editor with the project open will get a 409 on its next save
  and the existing conflict dialog handles it — that is the correct outcome, not
  a bug to design away.
- **`dryRun` is worth building early.** "What would this do to my project?"
  before the first real sync is the difference between trying it and not.

### Validating `url`

The `url` is user-controlled and ends up in an `href` in the editor and in the
HTML export. **Allow `obsidian://` and `https://` only**; reject everything else
server-side. A `javascript:` URL here would be stored XSS in every export.

---

## 7. Getting back to the note

`obsidian://open?vault=<vault>&file=<path>` is the official URI scheme. Both
components must be URL-encoded; the file path is given without the `.md`
extension.

Where it appears:

- **Inspector:** an "Open in Obsidian" button on any item with a `source`.
- **Card:** a small glyph, shown on hover, that opens the note. Clicking the
  card itself must keep selecting it — losing selection to a jump would make the
  card uneditable.
- **HTML export:** wrap source-backed cards in `<a href="obsidian://…">`.

Known limits, all worth telling the user rather than discovering:

- The browser shows a "Open Obsidian?" prompt the first time. Unavoidable.
- It only works where Obsidian is installed and that vault exists locally.
- A sandboxed `<iframe>` blocks custom schemes. Inside Obsidian's own reading
  view the links work; on a public website they may not.
- The vault name is part of the URL, so renaming the vault breaks existing
  links. Store the vault name per sync so a re-sync repairs them.

The [Advanced URI](https://github.com/Vinzent03/obsidian-advanced-uri) plugin
can target a heading or block, but it is a third-party dependency. Plain
`obsidian://open` first; treat the rest as an option.

---

## 8. The plugin

`obsidian-plugin/` in this repository, but outside the npm workspaces: it has
its own `package.json`, its own `npm install`, and its own esbuild build.

```
main.ts            plugin entry, commands, ribbon, status bar
settings.ts        settings tab: server, token, bindings
scanner.ts         which notes match which binding
frontmatter.ts     date parsing, including the leading-zero recovery
client.ts          Chronoplot API client (uses requestUrl)
types.ts
```

**Settings tab:** server URL, token, a "Test connection" button that names the
account it authenticated as, then the list of bindings with a project picker
fed from `GET /api/projects`.

**Commands**, as built: "Sync to Chronoplot", "Preview sync (changes nothing)",
and "List dated notes that no project claims" — the last answers §9.5.

**When to sync:** manual by default. Offer "on save, debounced" and "every N
minutes" as options, both off initially — a plugin that talks to the network
unprompted on first install is a bad neighbour.

**Networking:** use Obsidian's `requestUrl`, not `fetch`. It runs outside the
renderer's CORS rules, so the server needs no CORS changes at all.

**Reporting:** a status bar item with the last result, and a modal listing
per-note warnings after a sync. Silent partial failure is the thing to avoid.

---

## 9. Decisions that were open, and how they went

1. **Property prefix.** Configurable, defaulting to `chronoplot`. Anyone who
   wants `cp-start` sets the prefix to `cp`; no alias table to keep in sync.
2. **Milestones.** Start with no end *is* the signal, and
   `chronoplot-kind: milestone` also works. Requiring the property would mean
   the commonest case needs two lines instead of one.
3. **Deleting a note.** Its card goes at the next sync, with no grace period —
   but `dryRun` reports removals first, and the sync report names them. A grace
   period would mean storing a tombstone and explaining it; "preview, then
   sync" is the same safety with nothing to remember.
4. **Multiple vaults into one project.** Allowed, and the `vault` key is what
   makes it safe: a sync from one vault never touches another's cards. Not
   encouraged in the UI, because the sensible default is one vault.
5. **Notes outside every binding.** Reported, by the command "List dated notes
   that no project claims". Silence would make a typo'd folder path look like a
   working configuration.
6. **Token scope.** Recommended, not enforced. The settings tab explains why
   (§5's storage caveat) and the token dialog defaults to naming a project, but
   an unscoped token stays possible — someone syncing several projects from one
   vault would otherwise need to paste several tokens.

---

## 10. What was built, and where

**Phase 1 — API tokens. Done.**
`api_tokens` table in `server/src/db/schema.ts`, `server/src/auth/tokens.ts`,
the bearer hook in `server/src/auth/plugin.ts`, `server/src/routes/tokens.ts`,
and the "API tokens" tab in `web/src/features/account/`. Covered by
`server/test/smoke.mjs`: a token works, a revoked one does not, a scoped one is
refused elsewhere, and a token can neither mint tokens nor change the password.

**Phase 2 — the sync endpoint. Done.**
`itemSourceSchema` in `shared/src/index.ts`, the pure reconciler in
`server/src/sync-source.ts`, and `POST /api/projects/:id/sync` in
`server/src/routes/projects.ts`. `server/test/reconcile.test.ts` exercises the
reconciler directly (36 checks); the smoke test drives the endpoint over HTTP,
including the `javascript:` refusal.

**Phase 3 — links back. Done.**
`SourceLink` in `web/src/features/timeline/TimelineCard.tsx` (the glyph travels
with the title, so it never lands under a resize grip), the "From Obsidian"
section in `web/src/features/editor/Inspector.tsx`, and `<a class="cp-link">`
wrappers in `web/src/features/export/html-export.ts`. The export's pan handler
cancels a click that moved more than 6px, so panning across a card does not
jump to Obsidian.

**Phase 4 — the plugin. Done.** `obsidian-plugin/`, with
`obsidian-plugin/test/frontmatter.test.ts` covering the leading-zero trap.

**Phase 5 — polish. Mostly done.**
Sync on save and "every N minutes" are both in the settings tab, both off by
default; the per-note warnings modal is `ReportModal` in `main.ts`. Still open:
**vault rename repair.** Renaming a vault invalidates every stored `url`, and
nothing currently rewrites them — a re-sync from the renamed vault fixes its own
cards, so the gap only shows on a project nobody re-syncs.
