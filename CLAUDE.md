# Chronoplot

Self-hosted timeline editor. Create a project, set the range it spans, drag out
cards on lanes, export a vector PDF or a standalone interactive HTML file.

Three workspaces: `shared/` (the document model), `server/` (Fastify API),
`web/` (React editor). `docs/` holds the design system and feature plans.

---

## Rules that are not negotiable

**The database holds real user data.** `data/chronoplot.sqlite` is production
data, not test content. Never delete, reset or overwrite it. Before anything
that touches it — migrations, driver changes, destructive SQL — run
`node scripts/backup-db.mjs` and confirm it prints `VERIFIED`. A plain file copy
is *not* a backup: WAL journalling keeps recent commits in a separate `-wal`
file, so a copy of just the `.sqlite` can be nearly empty.

**Rehearse migrations.** They run automatically on boot, which is exactly why
they need rehearsing before they meet real data:

```bash
node scripts/check-migration.mjs copy
DATABASE_URL=backups/migration-rehearsal.sqlite PORT=5189 npm start
node scripts/check-migration.mjs verify
```

**Visual testing is the user's job.** Do not drive a browser to eyeball the UI.
Verify with the automated checks below and say plainly which parts are covered
and which are left for their visual pass.

**English everywhere** in code, comments, UI text and commit messages.

---

## Commands

```bash
npm run dev            # API on :5174, app on :5173
npm run build          # typecheck + build both workspaces
npm run typecheck
npm start              # run the built server, which also serves the built app

node server/test/smoke.mjs                                        # needs a server running
npx tsx --tsconfig web/tsconfig.json web/test/dates.test.ts       # calendar maths
npx tsx --tsconfig web/tsconfig.json web/test/axis.test.ts        # axis windowing + zoom
npx tsx --tsconfig web/tsconfig.json web/test/reorder.test.ts     # lane and group ordering
npx tsx --tsconfig web/tsconfig.json web/test/packing.test.ts     # labels, snapping, link routing
npx tsx --tsconfig web/tsconfig.json web/test/pdf-plan.test.ts    # pagination and scale
npx tsx --tsconfig web/tsconfig.json web/test/html-export.test.ts # HTML output and escaping
```

The smoke test drives the real API over HTTP and takes `BASE` / `ORIGIN`, so it
can be pointed at a production build. `ORIGIN` must equal the server's
`APP_ORIGIN` — the origin check is one of the things under test.

---

## Architecture, and why

**The document is the single source of truth.** Everything the editor shows is
derived from it, including the active theme. Applying something imperatively
"as well" is how state gets out of step — a theme that only updated on load was
a real bug from exactly that.

**New document fields are optional.** `row.color`, `item.progress` and
`item.notes` are all optional so documents written before them stay valid.
Extend the model that way; there is no migration path for documents.

**One geometry module.** `web/src/features/timeline/geometry.ts` computes every
position. The screen renderer feeds it pixels, the PDF exporter millimetres, the
HTML exporter SVG units. Neither renderer has layout logic of its own — that is
what makes "what you arranged is what you print" true by construction rather
than by keeping three implementations in agreement. Decisions like which side a
label sits on belong in the packer, because it has to reserve the space.

**Editing never waits on the network.** The whole document lives in the browser
and all layout runs there. `web/src/state/sync.ts` pushes it up after a quiet
period and on tab hide, with version-conflict detection rather than silent
last-write-wins.

**Authorisation is resolved before every project read or write.** `loadAccess`
in `server/src/routes/projects.ts`; nothing bypasses it. A project the caller
cannot see reports as missing, not forbidden, so ids cannot be probed.

**Both halves are served from one origin.** That is what lets the session cookie
stay `SameSite=Lax` with no CORS exceptions. Splitting them means revisiting
`server/src/auth/plugin.ts`.

---

## Design

`docs/DESIGN.md` is the contract — type scale, spacing, motion, five themes, and
the validated card palette with its measured colourblind-separation figures.
Every value on screen traces back to a token there. If something needs a new
shadow, radius or duration, the component is usually wrong.

---

## Planned work

`docs/OBSIDIAN-INTEGRATION.md` — a full concept for an Obsidian plugin that
turns dated notes into cards, and the Chronoplot work it needs: API tokens,
a source-owned sync endpoint, and `obsidian://` links back to the note. It is
written to be picked up cold and ends with open questions and a build order.
**Read it before starting that feature.** Nothing in it is built yet.

---

## Conventions

- Comments explain *why*, not what. Several in this codebase record a bug that
  was fixed and how — leave those in place.
- Commit messages are English, and say what changed and why it was wrong before.
- Never commit `.env`, `data/` or `backups/` (all git-ignored).
- PowerShell 5.1 is the shell here: it mangles UTF-8 on `Get-Content`/
  `Set-Content` round-trips. Use the Edit tool for source files, not shell
  text replacement — that corrupted an ellipsis in the PDF exporter once.
