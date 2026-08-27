# Chronoplot Design System

This document is the contract. Every screen, component and export in Chronoplot
is built from the primitives defined here. If something on screen does not trace
back to a token below, it is a bug — not a style choice.

The goal is a product that reads as **deliberate**: one type scale, one spacing
rhythm, one motion language, one set of surfaces. Consistency is what separates a
designed tool from an assembled one.

---

## 1. Principles

1. **The timeline is the product.** Chrome recedes; the plot area gets the
   contrast, the saturation and the motion. Panels are quiet.
2. **Every value is a token.** No raw hex, no magic pixel numbers in components.
   Themes are swapped by redefining custom properties — nothing else.
3. **Motion explains, never decorates.** An animation exists to show *where a
   thing came from* or *what changed*. If it cannot answer that, remove it.
4. **The screen and the PDF are the same drawing.** Both render from the same
   geometry module, so what you arrange is what you print.
5. **Nothing is encoded by colour alone.** Every card carries its own text label;
   colour groups, it never decodes. This is also what licenses the palette
   choices in §6.

---

## 2. Typography

One family, used at every size: **Inter** (variable), with a system fallback
stack. A single family across UI and plot is what keeps the print export looking
like the app.

```
--font-sans: "Inter var", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

The scale is a **1.2 (minor third) ratio**, rounded to whole pixels and capped at
seven steps. More steps than this is how type systems rot.

| Token | Size / line-height | Weight | Used for |
|---|---|---|---|
| `--text-display` | 30 / 36 | 600 | Empty-state headlines only |
| `--text-title` | 20 / 28 | 600 | Dialog + page titles |
| `--text-heading` | 16 / 24 | 600 | Panel section headers |
| `--text-body` | 14 / 20 | 400 | Default UI text |
| `--text-label` | 13 / 18 | 500 | Buttons, inputs, card titles |
| `--text-caption` | 12 / 16 | 500 | Axis ticks, metadata |
| `--text-micro` | 11 / 14 | 600 | Uppercase eyebrows, badges (`0.04em` tracking) |

**Numerals.** Axis ticks, date fields and any vertically aligned column use
`font-variant-numeric: tabular-nums`. Everything else uses proportional figures.
A time axis whose labels shift horizontally as digits change looks broken.

---

## 3. Space & size

A **4px base unit**. Every margin, padding and gap is a multiple; there are no
in-between values.

```
--space-1: 4px    --space-4: 16px   --space-7: 40px
--space-2: 8px    --space-5: 24px   --space-8: 48px
--space-3: 12px   --space-6: 32px   --space-9: 64px
```

Fixed structural sizes (these are layout constants, not free parameters):

| Token | Value | Meaning |
|---|---|---|
| `--row-height` | 44px | One timeline lane |
| `--row-gap` | 8px | Space between lanes |
| `--card-height` | 32px | A bar inside a lane |
| `--axis-height` | 56px | Time-axis header (two tiers) |
| `--sidebar-width` | 264px | Row/group list |
| `--inspector-width` | 320px | Right-hand properties panel |
| `--rail-height` | 52px | Top toolbar |

### Radii

```
--radius-sm: 6px     inputs, small buttons, swatches
--radius-md: 10px    cards, timeline bars, menu items
--radius-lg: 14px    panels, popovers
--radius-xl: 20px    dialogs, empty-state containers
--radius-full: 999px pills, avatars, the today-marker head
```

### Elevation

Shadows are **tinted with the theme's shadow colour**, never pure black. Four
levels, no more. Each combines a tight contact shadow with a wide ambient one —
a single blur reads flat and cheap.

```
--shadow-1  card resting on the canvas
--shadow-2  dropdown, popover
--shadow-3  dialog, drag preview
--shadow-4  the dragged card itself (lifted)
```

---

## 4. Motion

Motion tokens are shared by CSS transitions and the `motion` library, so a
component animated either way feels identical.

| Token | Duration | Used for |
|---|---|---|
| `--dur-instant` | 90ms | Hover/active colour changes |
| `--dur-fast` | 150ms | Tooltips, checkboxes, small toggles |
| `--dur-base` | 220ms | Panels, popovers, card enter/exit |
| `--dur-slow` | 380ms | Dialogs, view transitions, zoom settling |

| Easing | Curve | Used for |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Almost everything |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving the screen |
| `--ease-spring` | spring(stiffness 420, damping 34) | Drag release, card snap |

**Rules.**

- Entering elements ease *out* (fast start, soft landing). Leaving elements ease
  *in* and are always faster than their entrance — an exit should never make the
  user wait.
- Dragging is **direct manipulation**: the card tracks the pointer with zero
  transition. The spring applies only on release, when the card snaps to its grid
  position.
- Layout shifts (reordering rows, expanding a group) animate position, never
  `height` from `0` — that produces the rubber-band effect that reads as cheap.
- Everything respects `prefers-reduced-motion: reduce`, which collapses all
  durations to `1ms` and disables the spring. This is enforced in one place, in
  `tokens.css`.

---

## 5. Surfaces & ink (the theme contract)

Every theme defines exactly these roles. A theme that leaves one out will not
render correctly — there are no fallbacks by design, so omissions are loud.

| Role | Meaning |
|---|---|
| `--canvas` | Outermost app background |
| `--surface` | Panels, sidebar, toolbar |
| `--surface-raised` | Popovers, dialogs, hovered rows |
| `--surface-sunken` | Plot background, inputs, wells |
| `--border` | Hairline divider |
| `--border-strong` | Emphasised divider, input focus outline base |
| `--ink` | Primary text |
| `--ink-muted` | Secondary text, inactive icons |
| `--ink-subtle` | Axis ticks, placeholders, disabled text |
| `--accent` | Brand accent — primary buttons, selection, today marker |
| `--accent-hover` | Accent, one step warmer/brighter |
| `--accent-ink` | Text drawn *on* the accent |
| `--accent-soft` | Low-alpha accent wash (selected rows, ghost buttons) |
| `--grid-line` | Minor time gridline |
| `--grid-line-strong` | Major time gridline (year/month boundary) |
| `--shadow-color` | Tint that all four elevations are built from |

### The five themes

| Theme | Mode | Character | Accent |
|---|---|---|---|
| **Midnight** *(default)* | dark | Deep blue-slate, the "studio at night" default | Periwinkle `#6d8cff` |
| **Eclipse** | dark | Neutral graphite, zero colour cast — for long sessions | Amber `#e0a03a` |
| **Abyss** | dark | Cool deep teal, high-contrast and crisp | Aqua `#2fd4b0` |
| **Daylight** | light | Clean cool white, the presentation/printing default | Indigo `#3055d8` |
| **Parchment** | light | Warm paper, low glare, reads well on projectors | Terracotta `#a8622a` |

Themes are applied as `data-theme="midnight"` on `<html>`. Each theme also sets
`color-scheme` so native form controls and scrollbars follow.

**Status colours are fixed and never themed** — `good`, `warning`, `serious`,
`critical` keep the same value in all five themes so a warning never changes
meaning with the theme. They are always paired with an icon and a label.

---

## 6. Card palette

Timeline cards use an **eight-slot categorical palette** with separate steps for
light and dark themes. The dark column is the same eight hues re-stepped for a
dark surface — not a second palette, and not an automatic flip.

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4a3aa7` | `#9085e9` |
| 8 | red | `#e34948` | `#e66767` |

**Why these values, and how they were checked.** The palette and its slot
ordering are taken from a validated reference instance rather than picked by eye,
and were re-run against Chronoplot's own surfaces (`#f4f5f7` light, `#121721`
dark). Both modes pass every gate: lightness band, chroma floor, colourblind
separation (worst adjacent ΔE 9.1 light / 8.4 dark under protanopia and
deuteranopia, target ≥ 8) and the normal-vision floor (19.6 / 19.3, floor 15).

Three slots sit below 3:1 against the light surface. That is permitted here
because **every card renders its own title as visible text** — the label is the
relief channel, so colour never has to carry the identity alone. This is a real
constraint, not a footnote: a card variant that hides its label must also draw a
border in the card colour.

Ordering is not cosmetic — it is the colourblind-safety mechanism. Slots are
assigned in sequence and **never cycled**. A ninth colour is not generated; the
picker offers these eight plus a neutral slate for "no category", and that is the
whole set.

**Text on cards** is chosen per slot by contrast, not per theme, so a card looks
the same in every theme: each slot stores whether its label is drawn in white or
in near-black ink.

---

## 7. Component rules

- **Buttons.** Three variants only: `primary` (accent fill), `secondary`
  (surface + border), `ghost` (transparent, `--accent-soft` on hover). One
  destructive variant reusing `critical`. Heights snap to 28 / 32 / 40px.
- **Inputs** sit on `--surface-sunken` with a `--border` hairline; focus replaces
  the hairline with a 2px `--accent` ring plus a soft outer glow at 20% alpha.
  Focus is never removed, only restyled.
- **Panels** use `--radius-lg`, a single `--border` hairline, and `--shadow-1`.
  Panels never nest more than two deep.
- **Popovers/dialogs** get `--shadow-2` / `--shadow-3`, animate from 0.96 scale
  and 4px offset, and always trap focus.
- **Timeline cards** are `--card-height` tall, `--radius-md`, filled with their
  slot colour, label inset 8px. Selection is a 2px `--accent` ring offset 2px
  outside the card — never a colour change, which would destroy the grouping the
  colour encodes.
- **Icons** are 16px stroke icons on a 20px box, `1.5px` stroke, inheriting
  `currentColor`. 20px in the toolbar only.

---

## 8. What not to do

These are the specific failure modes this system exists to prevent.

- No gradients on surfaces. The only gradient in the product is the fade mask at
  the horizontal edges of the plot area.
- No glassmorphism/backdrop blur except on the dialog overlay.
- No more than one accent colour visible in a single view.
- No colour-only state. Selected, disabled and error states each change shape,
  ring or icon in addition to colour.
- No animation longer than `--dur-slow` on an interactive path.
- No new shadow, radius or duration value. If a component seems to need one, the
  component is wrong.
