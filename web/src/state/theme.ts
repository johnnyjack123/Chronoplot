/*
 * Theme selection.
 *
 * Two things can set the theme and they mean different things: the *project*
 * carries a theme so a shared timeline looks the same for everyone who opens
 * it, and the *viewer* can override that for their own screen without changing
 * the project. The override wins locally and is never synced.
 */
import { create } from "zustand";
import type { ThemeName } from "@shared";

export const THEMES: { name: ThemeName; label: string; mode: "dark" | "light"; blurb: string }[] = [
  { name: "midnight", label: "Midnight", mode: "dark", blurb: "Deep blue-slate. The studio default." },
  { name: "eclipse", label: "Eclipse", mode: "dark", blurb: "Neutral graphite, no colour cast." },
  { name: "abyss", label: "Abyss", mode: "dark", blurb: "Cool deep teal, high contrast." },
  { name: "daylight", label: "Daylight", mode: "light", blurb: "Clean and cool. Best for printing." },
  { name: "parchment", label: "Parchment", mode: "light", blurb: "Warm paper, low glare." },
];

const STORAGE_KEY = "chronoplot.theme";
const KNOWN = new Set(THEMES.map((theme) => theme.name));

export const isThemeName = (value: unknown): value is ThemeName =>
  typeof value === "string" && KNOWN.has(value as ThemeName);

function readStored(): ThemeName | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeName(stored) ? stored : null;
  } catch {
    // Private mode or blocked storage: fall back to the project's theme.
    return null;
  }
}

interface ThemeState {
  /** The viewer's personal override, or null to follow the project. */
  override: ThemeName | null;
  /** Whatever the open project asks for. */
  projectTheme: ThemeName;
  active: ThemeName;
  setOverride: (theme: ThemeName | null) => void;
  setProjectTheme: (theme: ThemeName) => void;
}

function apply(theme: ThemeName): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  override: readStored(),
  projectTheme: "midnight",
  active: readStored() ?? "midnight",

  /*
   * These only update state. Putting the DOM write in one effect that watches
   * `active` (see App) means the order in which a caller happens to set the
   * override and the project theme cannot produce a stale or flickering
   * result - a real bug when both changed in the same handler.
   */
  setOverride: (theme) => {
    try {
      if (theme) localStorage.setItem(STORAGE_KEY, theme);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Storage is optional; the theme still applies for this session. */
    }
    set({ override: theme, active: theme ?? get().projectTheme });
  },

  setProjectTheme: (theme) => set({ projectTheme: theme, active: get().override ?? theme }),
}));

/** The only place that writes the theme to the document. */
export const applyTheme = apply;

/** Applies the stored theme once at startup, before the first render. */
export function initTheme(): void {
  apply(useThemeStore.getState().active);
}

export const themeMode = (theme: ThemeName): "dark" | "light" =>
  THEMES.find((entry) => entry.name === theme)?.mode ?? "dark";
