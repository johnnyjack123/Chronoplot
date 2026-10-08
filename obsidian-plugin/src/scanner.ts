import type { App, TFile } from "obsidian";
import { combinePrecision, parseFrontmatterDate } from "./frontmatter";
import type { Binding, OutgoingItem, PluginSettings, ScanResult } from "./types";

/*
 * Deciding which notes belong to which project, and turning them into cards.
 *
 * Every problem is collected and reported rather than thrown: one note with a
 * mistyped date must not stop the other forty from syncing, and a silent skip
 * is worse than either.
 */

/** A path matches if it is the file itself, or a folder containing it. */
function matches(filePath: string, pattern: string): boolean {
  const clean = pattern.replace(/^\/+|\/+$/g, "");
  if (!clean) {
    return true;
  } // An empty pattern means the whole vault.
  return filePath === clean || filePath.startsWith(`${clean}/`);
}

export function bindingClaims(binding: Binding, filePath: string): boolean {
  if (binding.exclude.some((pattern) => matches(filePath, pattern))) {
    return false;
  }
  return binding.include.some((pattern) => matches(filePath, pattern));
}

/**
 * The link that brings a card back to its note.
 *
 * `obsidian://open` takes the path without its extension, and both components
 * have to be encoded - a vault or folder with a space in it is otherwise a
 * broken link.
 */
export function obsidianUrl(vault: string, filePath: string): string {
  const withoutExtension = filePath.replace(/\.md$/i, "");
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(withoutExtension)}`;
}

function laneFor(binding: Binding, file: TFile, fromProperty: unknown): string | undefined {
  if (typeof fromProperty === "string" && fromProperty.trim()) {
    return fromProperty.trim();
  }

  if (binding.laneStrategy === "folder") {
    const folder = file.parent?.name;
    if (folder) {
      return folder;
    }
  }
  return binding.defaultLane.trim() || undefined;
}

export function scanForBinding(
  app: App,
  settings: PluginSettings,
  binding: Binding,
): ScanResult {
  const prefix = settings.propertyPrefix.trim() || "chronoplot";
  const key = (name: string): string => `${prefix}-${name}`;
  const vault = app.vault.getName();

  const items: OutgoingItem[] = [];
  const problems: string[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (!bindingClaims(binding, file.path)) {
      continue;
    }

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) {
      continue;
    }

    const rawStart = frontmatter[key("start")];
    // No start property at all is not a problem - most notes are not events.
    if (rawStart === undefined || rawStart === null || rawStart === "") {
      continue;
    }

    const start = parseFrontmatterDate(rawStart);
    if (!start) {
      problems.push(`${file.path}: ${key("start")} is not a date I can read (${String(rawStart)})`);
      continue;
    }
    if (start.recovered) {
      problems.push(`${file.path}: ${key("start")} ${start.recovered}`);
    }

    const rawEnd = frontmatter[key("end")];
    const hasEnd = rawEnd !== undefined && rawEnd !== null && rawEnd !== "";
    const end = hasEnd ? parseFrontmatterDate(rawEnd) : null;

    if (hasEnd && !end) {
      problems.push(`${file.path}: ${key("end")} is not a date I can read (${String(rawEnd)})`);
      continue;
    }
    if (end?.recovered) {
      problems.push(`${file.path}: ${key("end")} ${end.recovered}`);
    }

    if (end && end.iso < start.iso) {
      problems.push(`${file.path}: ends before it starts`);
      continue;
    }

    const explicitKind = frontmatter[key("kind")];
    const color = frontmatter[key("color")];
    const title = frontmatter[key("title")];

    items.push({
      path: file.path,
      // The note's own name is the obvious title; a property overrides it.
      title: (typeof title === "string" && title.trim()) || file.basename,
      start: start.iso,
      ...(end ? { end: end.iso } : {}),
      // A range is only as precise as its coarser end.
      precision: end ? combinePrecision(start.precision, end.precision) : start.precision,
      ...(explicitKind === "bar" || explicitKind === "milestone" ? { kind: explicitKind } : {}),
      ...(() => {
        const lane = laneFor(binding, file, frontmatter[key("lane")]);
        return lane ? { lane } : {};
      })(),
      ...(Number.isInteger(color) && color >= 0 && color <= 8 ? { color } : {}),
      url: obsidianUrl(vault, file.path),
    });
  }

  return { items, problems, unassigned: [] };
}

/**
 * Notes that carry a start date but sit outside every binding.
 *
 * Reported rather than ignored: a note with dates that never appears on any
 * timeline looks like the plugin is broken, and the real cause - no binding
 * covers its folder - is invisible from the note itself.
 */
export function findUnassigned(app: App, settings: PluginSettings): string[] {
  const prefix = settings.propertyPrefix.trim() || "chronoplot";
  const startKey = `${prefix}-start`;

  return app.vault
    .getMarkdownFiles()
    .filter((file) => {
      const value = app.metadataCache.getFileCache(file)?.frontmatter?.[startKey];
      if (value === undefined || value === null || value === "") {
        return false;
      }
      return !settings.bindings.some((binding) => bindingClaims(binding, file.path));
    })
    .map((file) => file.path);
}
