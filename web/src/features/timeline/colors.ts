/*
 * Card colour lookup.
 *
 * Slots 1-8 are the categorical palette; slot 0 is the neutral slate for "no
 * category". Each slot carries the ink its label is drawn in, chosen by
 * contrast when the palette was validated - see docs/DESIGN.md section 6. The
 * ink never depends on the theme, so a card reads the same everywhere.
 */

export const CARD_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export type CardSlot = (typeof CARD_SLOTS)[number];

export const SLOT_NAMES: Record<CardSlot, string> = {
  0: "Slate",
  1: "Blue",
  2: "Orange",
  3: "Aqua",
  4: "Yellow",
  5: "Magenta",
  6: "Green",
  7: "Violet",
  8: "Red",
};

/** CSS custom-property references, so the value follows the active theme. */
export function cardFill(slot: number): string {
  return slot === 0 ? "var(--card-slate)" : `var(--card-${slot})`;
}

export function cardInk(slot: number): string {
  return slot === 0 ? "var(--card-slate-ink)" : `var(--card-${slot}-ink)`;
}

/**
 * Resolves a slot to a concrete hex for the PDF exporter, which cannot use
 * custom properties. Reads from the live document so the exported colours match
 * whatever theme is on screen.
 */
export function resolveCardHex(slot: number, root: HTMLElement = document.documentElement): string {
  const name = slot === 0 ? "--card-slate" : `--card-${slot}`;
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  return value || "#7c8698";
}

export function resolveCardInkHex(slot: number, root: HTMLElement = document.documentElement): string {
  const name = slot === 0 ? "--card-slate-ink" : `--card-${slot}-ink`;
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  // The ink tokens are themselves aliases, so fall back to resolving the alias.
  if (value.startsWith("var(")) {
    const alias = value.slice(4, -1).trim();
    return getComputedStyle(root).getPropertyValue(alias).trim() || "#ffffff";
  }
  return value || "#ffffff";
}

/**
 * A lane's background wash.
 *
 * Deliberately faint. The lane tint and the cards on it use the same eight
 * slots, so if the wash were anywhere near as saturated as a card the two would
 * compete and the cards would stop reading as the foreground.
 */
export const LANE_TINT_STRENGTH = 0.24;

export function laneTint(slot: number | undefined): string | undefined {
  if (slot === undefined) {
    return undefined;
  }
  return `color-mix(in oklab, ${cardFill(slot)} ${LANE_TINT_STRENGTH * 100}%, transparent)`;
}

/** Any theme token, resolved to a concrete value for export. */
export function resolveToken(name: string, root: HTMLElement = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(name).trim();
}
