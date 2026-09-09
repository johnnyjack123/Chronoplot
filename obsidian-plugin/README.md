# Chronoplot for Obsidian

Turns dated notes into cards on a [Chronoplot](../README.md) timeline. One
direction only: notes own their dates, Chronoplot owns how they look.

This folder is **outside the npm workspaces** on purpose — it builds against
Obsidian's API and shares nothing with the server — so it has its own
`npm install`.

## Build

```bash
cd obsidian-plugin
npm install
npm run build        # typecheck, then a minified main.js
npm run dev          # rebuild on change, with an inline source map
npm test             # the frontmatter parser
```

The build writes `main.js` next to `manifest.json`. Those two files are the
plugin; `obsidian` and the CodeMirror packages stay external because Obsidian
provides them at runtime.

`@types/node` and `tsx` look unused here and are not — the test suite uses
`process.exit` and runs through `tsx`. They have to be declared *in this
folder*: this tree sits inside the Chronoplot repository, so on a developer
machine TypeScript finds the root's `node_modules/@types` by walking up the
directory chain and `npx` finds the root's binaries. CI installs only this
folder, which is the point, and there both lookups come up empty.

## Install into a vault

There is no community-plugin listing, so install it by hand:

```bash
mkdir -p /path/to/vault/.obsidian/plugins/chronoplot
cp main.js manifest.json /path/to/vault/.obsidian/plugins/chronoplot/
```

Then in Obsidian: **Settings → Community plugins → Reload plugins**, and enable
**Chronoplot**. Community plugins must be turned on for the vault first
(Restricted mode off).

To update, copy the two files over and use **Reload plugins** again.

## Set it up

1. In Chronoplot: project list → your name → **API tokens**. Create one, scoped
   to a single project. It is shown once.
2. In the plugin's settings: the server URL and that token, then **Test** — it
   names the account it authenticated as and loads your projects.
3. Under **Projects**, add a project and list the folders to include.

## Frontmatter

```yaml
---
chronoplot-start: "01.03.2026"
chronoplot-end: "30.09.2026"
chronoplot-title: Platform migration   # optional, defaults to the note name
chronoplot-lane: Engineering           # optional
chronoplot-color: 3                    # optional, palette slot 0-8
chronoplot-kind: bar                   # optional: bar | milestone
---
```

`01.03.2026` is a day, `03.2026` a month, `2026` a year, and the precision
follows the form. `2026-03-01` works too. A start with no end is a milestone.
The prefix is configurable.

**Quote the dates.** Unquoted, YAML reads `"01.03.2026"` as a string but
`01032026` as a number and silently drops the leading zero. The plugin pads a
number back to the nearest valid length and reports that it guessed, but quoting
removes the guess.

## Commands

| Command | What it does |
|---|---|
| Sync to Chronoplot | Pushes every binding |
| Preview sync (changes nothing) | Same scan, `dryRun` — reports what would change |
| List dated notes that no project claims | Catches a typo'd include path |

Sync on save and a timed sync are in the settings, both off by default.

## Two things to know

**The token is stored in plain text** in
`.obsidian/plugins/chronoplot/data.json`, inside your vault. A synced vault
carries it. Scope it to one project and give it an expiry.

**Deleting a note removes its card** at the next sync, along with any dependency
arrows attached to it. A sync only ever touches cards it created from this
vault: cards made by hand in Chronoplot, and cards from another vault, are left
alone. Lanes are created but never removed.

## Design

`../docs/OBSIDIAN-INTEGRATION.md` — the frontmatter contract, the sync
protocol, and the reasoning behind both.
