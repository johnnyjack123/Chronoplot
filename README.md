# Chronoplot

Build beautiful, printable timelines in the browser.

Create a project, set the range it spans, drag out cards on as many lanes as you
need, and export a clean vector PDF, a self-contained interactive HTML file, or
a project file to move it to another instance.

---

## Quick start

```bash
npm install
cp env.example .env      # then edit SESSION_SECRET
npm run dev
```

Open <http://localhost:5173>. The first account you register becomes the
administrator.

| Command | What it does |
|---|---|
| `npm run dev` | API on :5174 and the browser app on :5173, both watching |
| `npm run build` | Type-checks and builds both workspaces |
| `npm start` | Runs the built server, which also serves the built app |
| `npm run typecheck` | Type-checks without emitting |

Or with Docker:

```bash
docker pull ghcr.io/johnnyjack123/chronoplot:latest
```

---

## How it is put together

```
shared/     the timeline document model + validation, used by both sides
server/     Fastify API, session auth, SQLite or Postgres
web/        React editor, timeline geometry, exporters
docs/       design system, deployment, usage, plans
```

**Editing never waits on the network.** The whole document lives in the browser
and all layout maths runs there, which is what keeps dragging responsive. The
sync engine pushes it up after a short quiet period, and on tab hide or close.

**Screen and exports are the same drawing.** `web/src/features/timeline/`
`geometry.ts` computes every position; the React canvas feeds it pixels, the PDF
exporter millimetres, the HTML exporter SVG units. Neither renderer has layout
logic of its own, so an export cannot drift from what you arranged.

**One database, two engines.** SQLite by default, Postgres by changing two
environment variables. Everything that differs is contained in one adapter.

---

## Security

Session auth, deliberately conventional: **argon2id** password hashing, opaque
session tokens stored only as their SHA-256, httpOnly `SameSite=Lax` cookies, an
origin check plus a double-submit CSRF token, and per-IP and per-account rate
limiting. Every project read and write resolves the caller's role first; a
project you cannot see reports as missing rather than forbidden, so ids cannot
be probed.

Before pushing, `node scripts/audit-secrets.mjs` checks that nothing sensitive
is tracked — in the working tree or anywhere in the history.

---

## Tests

```bash
node server/test/smoke.mjs         # HTTP end-to-end; needs a server running
npx tsx --tsconfig web/tsconfig.json web/test/<suite>.test.ts
```

Suites: `dates` (calendar maths), `axis` (windowing and zoom), `reorder`
(lane and group ordering), `packing` (label placement, snapping, link routing),
`pdf-plan` (pagination and scale), `html-export` (output and escaping).

The smoke test drives the real API: registration, login, CSRF and cross-origin
rejection, sharing, read-only enforcement, version conflicts, project import,
and the admin surface.

---

## Documentation

| | |
|---|---|
| [docs/USING.md](docs/USING.md) | Accounts, editing, keyboard, exports, embedding in Obsidian |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Configuration, Docker, Postgres, backups, CI |
| [docs/DESIGN.md](docs/DESIGN.md) | The design system — type, spacing, motion, themes, palette |
| [docs/OBSIDIAN-INTEGRATION.md](docs/OBSIDIAN-INTEGRATION.md) | Concept for a planned Obsidian plugin |
