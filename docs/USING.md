# Using Chronoplot

Accounts, the editor, and getting timelines back out again.

---

## Accounts and administration

A brand-new instance opens on a **setup page** rather than a sign-in form: there
is nothing to sign in to yet, and asking for a password nobody has reads as a
broken deployment. The page says what the account being created is for.

The **first account to register becomes the administrator**, and that account
always gets in even with registration closed — otherwise an instance started
with `ALLOW_REGISTRATION=false` could never create one. Once it exists, the
setup page redirects to sign-in.

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

`scripts/delete-accounts.mjs` removes accounts by address, for what the admin
screen cannot reach. It shows what would go before it goes, and refuses to leave
the instance without an administrator.

### Locked out

If every administrator's password is lost, or registration is closed with no
usable account behind it, the way back in is from the host:

```bash
node scripts/reset-password.mjs                       # list accounts
node scripts/reset-password.mjs you@example.com       # set a generated password
node scripts/reset-password.mjs you@example.com --admin   # and promote them
```

In a container: `docker compose exec chronoplot node scripts/reset-password.mjs …`

The password is generated rather than prompted — it avoids a weak choice made
under pressure, and keeps it out of shell history. Every existing session for
that account is signed out, or the reset would achieve nothing against someone
already signed in.

**`ALLOW_REGISTRATION` is not an escape hatch.** It is read only when the stored
setting does not yet exist, so setting it on a running instance changes nothing.
Access to the database is the recovery credential — which for a self-hosted app
is the right one: whoever runs the server can always get back in, and nobody
else can.

---

## Editing

Drag across an empty lane to create a card; a single click makes a milestone.
Drag a lane by its grip handle to reorder it, or into and out of a group; groups
reorder the same way.

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

Double-clicking a card, lane or group renames it in place. New lanes open
straight into their name field.

The axis picks its own units as you zoom: the granularity setting is the
*finest* unit you want to see, and coarser ones take over on the way out. A
timeline can span centuries and still scroll smoothly, because only the visible
slice is ever built.

**Snapping** (the magnet in the toolbar) latches dragged edges onto other cards'
edges and today, and draws a line showing what it caught on. The threshold is in
pixels, so it feels the same at every zoom.

---

## Exports

All three live in one dialog, reached from the toolbar.

### PDF

Vector output — text stays selectable, nothing pixelates, and page breaks land
on calendar boundaries where one is close enough to the page edge. A one-page A4
export of a busy year is around 9 KB.

The scale presets set the horizontal scale only; **Custom** exposes both axes.
The horizontal slider is exponential, because usable scales span more than two
hundredfold and a linear one would bury the useful range in a few pixels of
travel. The vertical slider multiplies lane and bar heights without touching
text size — it makes rows roomier, not the type bigger. The page count updates
as you drag.

### Interactive HTML

One self-contained file — no fonts, scripts or styles fetched from anywhere — so
it works offline, inside an Obsidian note, or in an `<iframe>` on a site with a
strict content policy. Drag or scroll to pan, `Ctrl`+scroll to zoom, hover a
card for its exact dates.

Zooming transforms the drawing rather than re-laying it out, which avoids
shipping a second copy of the tick generator and packer into the file. Text
therefore scales like a map rather than staying a fixed size; the hover detail
is where the precision lives. Every piece of user text is escaped on the way out.

#### Embedding in Obsidian

No plugin needed. Put the file in your vault — a folder like `attachments/` is
fine — and embed it in a note:

```html
<iframe src="attachments/roadmap.html" width="100%" height="520"
        style="border:0;border-radius:10px"></iframe>
```

The path is relative to the vault root. Obsidian renders raw HTML in reading
view, so switch out of source mode to see it. Re-exporting over the same
filename updates every note that embeds it.

On a website it is the same tag, or just serve the file directly — it has no
dependencies and sets no cookies.

### Project file

Writes a `.chronoplot.json` file — the timeline document and nothing else, no
accounts and no sharing. Import it on another instance from the dashboard. The
file is validated before it is sent, so a truncated or foreign file is refused
with a readable message rather than a 422.

---

## The Obsidian plugin

Dated notes become cards. `obsidian-plugin/` in this repository holds it;
`obsidian-plugin/README.md` covers building and installing it, and
`docs/OBSIDIAN-INTEGRATION.md` explains the design.

The short version:

1. **Make a token.** On the project list, click your name, then **API tokens**.
   Scope it to one project. It is shown once — Chronoplot stores only its hash.
2. **Point the plugin at your server** and paste the token in.
3. **Say which notes feed which project**, under Projects in the plugin
   settings: a project, then the folders to include.
4. **Date some notes.** Two frontmatter keys are enough:

   ```yaml
   ---
   chronoplot-start: "01.03.2026"
   chronoplot-end: "30.09.2026"
   ---
   ```

   Quote the dates. Unquoted, YAML reads `01.03.2026` as a string but
   `01032026` as a *number* and drops the leading zero. The plugin recovers the
   likely value and warns, but quoting removes the guess.

   A start with no end is a milestone. `chronoplot-title`, `-lane`, `-color` and
   `-kind` are optional.
5. **Run "Preview sync (changes nothing)"** from the command palette. It
   reports what a sync would do. Then run **Sync to Chronoplot**.

Notes own titles and dates; Chronoplot owns colour, lane and position, and a
re-sync leaves them alone. Deleting a note removes its card at the next sync —
cards you made by hand in Chronoplot are never touched, and neither are cards
from a different vault.

A synced card shows a small note glyph; clicking it opens the note. The same
link is in the inspector, and in HTML exports.

> The plugin's token sits in `.obsidian/plugins/chronoplot/data.json` inside
> your vault, in plain text. If the vault is synced or in git, the token goes
> with it — which is the argument for scoping it to one project and giving it
> an expiry.

---

## Themes

**Midnight** (default), **Eclipse**, **Abyss**, **Daylight**, **Parchment**.

A project stores a theme so a shared timeline looks the same for everyone; a
viewer can override it locally without changing the project. Picking a theme in
the timeline settings clears your local override, because choosing the project's
theme is a statement about how it should look.

`docs/DESIGN.md` has the palettes and the reasoning behind them.
