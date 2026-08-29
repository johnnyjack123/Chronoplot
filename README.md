# Chronoplot

Build beautiful, printable timelines in the browser.

Create a project, set the range it spans, drag out cards on as many lanes as you need, and export a clean vector PDF that breaks across pages on calendar
boundaries.

---

## Quick start

```bash
npm install
cp env.example .env      # then edit SESSION_SECRET
npm run dev
```

Open <http://localhost:5173>. The first account you register owns everything it
creates; set `ALLOW_REGISTRATION=false` in `.env` once your team has signed up.

| Command | What it does |
|---|---|
| `npm run dev` | API on :5174 and the browser app on :5173, both watching |
| `npm run build` | Type-checks and builds both workspaces |
| `npm start` | Runs the built server, which also serves the built app |
| `npm run typecheck` | Type-checks without emitting |

In production the server serves the built browser app from its own origin. That
is what lets the session cookie stay `SameSite=Lax` with no CORS exceptions, so
do not split the two across different hosts without revisiting the cookie
settings in `server/src/auth/plugin.ts`.

---

## How it is put together

```
shared/     the timeline document model + validation, used by both sides
server/     Fastify API, session auth, SQLite or Postgres
web/        React editor, timeline geometry, PDF exporter
docs/       the design system
```

**Editing never waits on the network.** The whole document lives in the browser
and all layout maths runs there, which is what keeps dragging responsive. The
sync engine pushes the document up after a short quiet period, and on tab hide
or close. See `web/src/state/sync.ts`.

**Screen and PDF are the same drawing.** `web/src/features/timeline/geometry.ts`
computes every position; the React canvas feeds it pixels and the exporter feeds
it millimetres. Neither renderer has layout logic of its own, so the export
cannot drift from what you arranged.

**The PDF is drawn, not screenshotted.** Text stays selectable, nothing
pixelates, and page breaks land on calendar boundaries where one is close enough
to the page edge. A one-page A4 export of a busy year is around 9 KB.

**HTML export** produces one self-contained file — no fonts, scripts or styles
fetched from anywhere — so it works offline, inside an Obsidian note, or in an
`<iframe>` on a site with a strict content policy. Drag to pan, scroll to zoom,
hover a card for its exact dates. Zooming transforms the drawing rather than
re-laying it out, which is why text scales like a map instead of staying a fixed
size; the hover detail is where the precision lives. Every piece of user text is
escaped on the way out.

### Embedding the HTML export in Obsidian

The export is one file with everything inside it, so Obsidian needs no plugin.
Put the file in your vault — a folder like `attachments/` is fine — and embed it
in a note with an `<iframe>`:

```html
<iframe src="attachments/roadmap.html" width="100%" height="520"
        style="border:0;border-radius:10px"></iframe>
```

The path is relative to the vault root. Obsidian renders raw HTML in reading
view, so switch out of source mode to see it; drag to pan, scroll to zoom, hover
a card for its exact dates. Re-exporting over the same filename updates every
note that embeds it.

On a website it is the same tag, or just serve the file directly — it has no
dependencies and sets no cookies.

### Accounts and administration

The **first account to register becomes the administrator**, and that account
always gets in even with registration closed — otherwise an instance started
with `ALLOW_REGISTRATION=false` could never create one.

Administrators get a shield icon on the dashboard: create and delete accounts,
reset passwords, grant or remove admin rights, and open or close registration.
That switch is stored in the database, so it survives a restart;
`ALLOW_REGISTRATION` only sets the value a fresh instance starts with. The
server refuses to remove or demote the last remaining administrator.

Everyone can change their own display name and password from the account button.
Changing a password — or having one reset — signs that account out everywhere.

If an existing instance ends up with the wrong administrator (the migration
promotes the earliest account, which is a guess):

```bash
node scripts/make-admin.mjs                    # list accounts and their roles
node scripts/make-admin.mjs you@example.com    # promote that one
node scripts/make-admin.mjs you@example.com --only   # and demote the rest
```

### Moving a project between instances

Export writes a `.chronoplot.json` file — the timeline document and nothing
else, no accounts and no sharing. Import it on the other instance from the
dashboard. The file is validated before it is sent, so a truncated or foreign
file is refused with a readable message rather than a 422.

### Docker

```bash
SESSION_SECRET=$(openssl rand -hex 32) docker compose up -d --build
```

One image serves both the API and the browser app, which is what keeps them on
a single origin. The database lives on the `chronoplot-data` volume, never in an
image layer — losing that volume loses every project.

```bash
docker build -t chronoplot .        # image only
```

### Backups

```bash
node scripts/backup-db.mjs
```

Writes a timestamped, self-contained copy into `backups/` and verifies it by
reopening it and comparing row counts. Use this rather than copying the `.sqlite`
file: WAL journalling keeps recent commits in a separate `-wal` file, so a plain
copy can be almost empty. Safe to run while the server is up.

Schema migrations run on boot, which is convenient and also the reason to
rehearse one before it meets real data:

```bash
node scripts/check-migration.mjs copy      # copy the live database
DATABASE_URL=backups/migration-rehearsal.sqlite PORT=5189 npm start
node scripts/check-migration.mjs verify    # nothing lost, columns added
```

### Switching to Postgres

Change two lines in `.env` — no code changes, no migration tool:

```
DB_DRIVER=postgres
DATABASE_URL=postgres://user:password@localhost:5432/chronoplot
```

The schema is created on boot. Everything that differs between the two databases
is contained in `server/src/db/adapter.ts`; queries elsewhere are written once in
portable SQL.

---

## Security

Session auth, deliberately conventional:

- passwords hashed with **argon2id** at OWASP's parameters
- sessions are opaque random tokens in an httpOnly, `SameSite=Lax` cookie; the
  database stores only their SHA-256, so a database leak cannot be replayed
- CSRF defended twice over: an origin check plus a double-submit token derived
  from the session
- per-IP rate limiting, plus per-account attempt limiting on sign-in
- every project read and write resolves the caller's role first; a project you
  cannot see reports as missing rather than forbidden, so ids cannot be probed

Changing a password ends every existing session and issues the current browser a
fresh one.

---

## Tests

```bash
node server/test/smoke.mjs                                        # needs the server running
npx tsx --tsconfig web/tsconfig.json web/test/dates.test.ts       # calendar maths
npx tsx --tsconfig web/tsconfig.json web/test/axis.test.ts        # axis windowing + zoom
npx tsx --tsconfig web/tsconfig.json web/test/reorder.test.ts     # lane and group ordering
npx tsx --tsconfig web/tsconfig.json web/test/packing.test.ts     # label placement + snapping
npx tsx --tsconfig web/tsconfig.json web/test/html-export.test.ts # HTML output + escaping
npx tsx --tsconfig web/tsconfig.json web/test/pdf-plan.test.ts    # pagination
```

To point the smoke test at another instance:
`BASE=http://localhost:5188 ORIGIN=http://localhost:5188 node server/test/smoke.mjs`
(`ORIGIN` must equal the server's `APP_ORIGIN` — the origin check is one of the
things under test.)

The smoke test drives the real API over HTTP: registration, login, CSRF
rejection, cross-origin rejection, sharing, read-only enforcement, version
conflicts, document integrity, project import, and the admin surface —
including that a non-admin is refused it and that a password reset actually
invalidates the old password.

---

## Design

`docs/DESIGN.md` is the contract — type scale, spacing, motion, the five themes
and the card palette. Every value on screen traces back to a token there. The
card colours are a validated categorical palette rather than hand-picked hues;
the measured colourblind-separation numbers are recorded in section 6.

Themes: **Midnight** (default), **Eclipse**, **Abyss**, **Daylight**,
**Parchment**. A project stores a theme so a shared timeline looks the same for
everyone; a viewer can override it locally without changing the project.

---

## Keyboard

| | |
|---|---|
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+D` | Duplicate the selected card |
| `Delete` | Delete the selected card |
| `←` / `→` | Nudge by a day (`Shift` for a week) |
| `Ctrl+` `+` / `-` | Zoom, or `Ctrl`+scroll to zoom around the pointer |
| `Ctrl+0` | Fit the whole timeline on screen |
| `Alt+↑` / `Alt+↓` | Reorder the selected lane or group |
| `Esc` | Clear the selection, back to timeline settings |

Drag across an empty lane to create a card; a single click makes a milestone.
Drag a lane by its grip handle to reorder it, or into and out of a group;
groups reorder the same way.

The axis picks its own units as you zoom: the granularity setting is the
*finest* unit you want to see, and coarser ones take over on the way out. A
timeline can span centuries and still scroll smoothly, because only the visible
slice is ever built.
