import { Modal, Notice, Plugin, debounce } from "obsidian";
import { ApiError, ChronoplotClient } from "./client";
import { findUnassigned, scanForBinding } from "./scanner";
import { ChronoplotSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type PluginSettings, type SyncResponse } from "./types";

/*
 * Chronoplot for Obsidian.
 *
 * One direction only: notes describe when things happen, and this pushes that
 * to a Chronoplot timeline. Nothing is written back into the vault. Two-way
 * sync would mean deciding who wins when both change, and for prose that
 * question has no good answer.
 */
export default class ChronoplotPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private status: HTMLElement | null = null;
  private timer: number | null = null;

  private readonly syncSoon = debounce(() => void this.sync(false, true), 4000, true);

  async onload(): Promise<void> {
    await this.loadSettings();

    this.status = this.addStatusBarItem();
    this.setStatus("Chronoplot: idle");

    this.addSettingTab(new ChronoplotSettingTab(this.app, this));

    this.addRibbonIcon("calendar-clock", "Sync to Chronoplot", () => void this.sync(false));

    this.addCommand({
      id: "sync",
      name: "Sync to Chronoplot",
      callback: () => void this.sync(false),
    });

    this.addCommand({
      id: "preview-sync",
      name: "Preview sync (changes nothing)",
      callback: () => void this.sync(true),
    });

    this.addCommand({
      id: "report-unassigned",
      name: "List dated notes that no project claims",
      callback: () => {
        const orphans = findUnassigned(this.app, this.settings);
        new ReportModal(
          this.app,
          "Dated notes with no project",
          orphans.length === 0
            ? ["Every dated note is covered by a project."]
            : orphans,
        ).open();
      },
    });

    /*
     * Registered only when asked for. A plugin that starts talking to a server
     * the moment it is installed is a bad neighbour, and the first sync is
     * exactly the one worth watching happen.
     */
    if (this.settings.syncOnSave) {
      this.registerEvent(this.app.vault.on("modify", () => this.syncSoon()));
    }
    this.restartTimer();
  }

  onunload(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
    }
  }

  restartTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const minutes = this.settings.syncIntervalMinutes;
    if (minutes > 0) {
      this.timer = window.setInterval(() => void this.sync(false, true), minutes * 60_000);
      this.registerInterval(this.timer);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private setStatus(text: string): void {
    this.status?.setText(text);
  }

  /**
   * @param dryRun report what would change without changing it
   * @param quiet suppress the success notice, for automatic runs
   */
  async sync(dryRun: boolean, quiet = false): Promise<void> {
    const configured = this.settings.bindings.filter((binding) => binding.projectId);
    if (configured.length === 0) {
      new Notice("Chronoplot: no projects configured yet. Check the plugin settings.");
      return;
    }

    const client = new ChronoplotClient(this.settings.serverUrl, this.settings.token);
    const vault = this.app.vault.getName();
    const lines: string[] = [];
    let failures = 0;
    let changes = 0;

    this.setStatus(dryRun ? "Chronoplot: checking…" : "Chronoplot: syncing…");

    for (const binding of configured) {
      const name = binding.projectTitle || binding.projectId;
      const scan = scanForBinding(this.app, this.settings, binding);

      try {
        const result = await client.sync(binding.projectId, vault, scan.items, dryRun);
        changes += result.created + result.updated + result.removed;
        lines.push(...describe(name, result, scan.items.length));
      } catch (error) {
        failures++;
        lines.push(
          `${name}: FAILED - ${error instanceof ApiError ? error.message : String(error)}`,
          ...(error instanceof ApiError && error.code === "token_scope"
            ? ["  (that token is scoped to a different project)"]
            : []),
        );
      }

      // Note problems last, so they read as footnotes to the result above.
      for (const problem of scan.problems) {
        lines.push(`  ${problem}`);
      }
    }

    const orphans = findUnassigned(this.app, this.settings);
    if (orphans.length > 0) {
      lines.push(
        "",
        `${orphans.length} dated note(s) are not claimed by any project. ` +
          `Run "List dated notes that no project claims" to see them.`,
      );
    }

    this.setStatus(
      failures > 0
        ? "Chronoplot: last sync failed"
        : `Chronoplot: ${dryRun ? "no changes made" : `${changes} change(s)`}`,
    );

    /*
     * A modal for anything worth reading, a notice for a clean automatic run.
     * Silent partial failure is the thing to avoid: a sync that skipped four
     * notes and said nothing is worse than one that failed outright.
     */
    const noteworthy = failures > 0 || dryRun || lines.some((line) => line.includes("  "));
    if (noteworthy || !quiet) {
      new ReportModal(
        this.app,
        dryRun ? "Sync preview" : "Sync result",
        lines.length > 0 ? lines : ["Nothing to do."],
      ).open();
    }
  }
}

function describe(name: string, result: SyncResponse, scanned: number): string[] {
  const parts = [
    `${result.created} created`,
    `${result.updated} updated`,
    `${result.removed} removed`,
  ];
  const lines = [`${name}: ${parts.join(", ")} (${scanned} dated note(s) found)`];

  if (result.lanesCreated.length > 0) {
    lines.push(`  new lanes: ${result.lanesCreated.join(", ")}`);
  }
  for (const warning of result.warnings) {
    lines.push(`  ${warning}`);
  }
  return lines;
}

class ReportModal extends Modal {
  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly heading: string,
    private readonly lines: string[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    const body = this.contentEl.createEl("pre");
    body.style.whiteSpace = "pre-wrap";
    body.style.userSelect = "text";
    body.style.margin = "0";
    body.setText(this.lines.join("\n"));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
