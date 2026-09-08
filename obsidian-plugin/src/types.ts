/** One mapping from a set of vault paths to one Chronoplot project. */
export interface Binding {
  projectId: string;
  /** Cached for display, so the settings screen works offline. */
  projectTitle: string;
  /** Vault-relative. A folder includes everything beneath it. */
  include: string[];
  /** Wins over include, so a folder can be taken with holes in it. */
  exclude: string[];
  laneStrategy: "property" | "folder" | "fixed";
  /** Used by the "fixed" strategy, and as the fallback for the others. */
  defaultLane: string;
}

export interface PluginSettings {
  serverUrl: string;
  token: string;
  /** Frontmatter key prefix, so `chronoplot-start` can be `cp-start` instead. */
  propertyPrefix: string;
  bindings: Binding[];
  /** Sync after a note is saved, debounced. Off by default. */
  syncOnSave: boolean;
  /** Minutes between automatic syncs; 0 disables it. */
  syncIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  serverUrl: "",
  token: "",
  propertyPrefix: "chronoplot",
  bindings: [],
  // Both off: a plugin that reaches the network unprompted on first install is
  // a bad neighbour, and the first sync is exactly when you want to watch it.
  syncOnSave: false,
  syncIntervalMinutes: 0,
};

/** One card, as this plugin describes it to the server. */
export interface OutgoingItem {
  path: string;
  title: string;
  start: string;
  end?: string;
  precision: "day" | "month" | "year";
  kind?: "bar" | "milestone";
  lane?: string;
  color?: number;
  notes?: string;
  progress?: number;
  url?: string;
}

export interface SyncResponse {
  created: number;
  updated: number;
  removed: number;
  lanesCreated: string[];
  warnings: string[];
  version: number;
  dryRun: boolean;
}

export interface ProjectSummary {
  id: string;
  title: string;
  role: string;
}

/** What a scan found, including what it could not use. */
export interface ScanResult {
  items: OutgoingItem[];
  /** Per-note problems, each naming its file so it can be fixed. */
  problems: string[];
  /** Notes carrying dates that no binding claims. */
  unassigned: string[];
}
