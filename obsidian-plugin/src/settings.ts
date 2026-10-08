import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { ChronoplotClient } from "./client";
import type ChronoplotPlugin from "./main";
import type { Binding, ProjectSummary } from "./types";

export class ChronoplotSettingTab extends PluginSettingTab {
  private projects: ProjectSummary[] = [];

  constructor(app: App, private readonly plugin: ChronoplotPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    /* ----------------------------------------------------- connection -- */

    new Setting(containerEl).setName("Connection").setHeading();

    new Setting(containerEl)
      .setName("Server address")
      .setDesc("Where your Chronoplot instance is reachable, for example https://chronoplot.example.com")
      .addText((text) =>
        text
          .setPlaceholder("https://chronoplot.example.com")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API token")
      .setDesc(
        "Create one in Chronoplot: on the project list, click your name, then API tokens. " +
          "Scope it to a single project if you can - Obsidian stores plugin settings as plain " +
          "text inside the vault, so a synced vault carries this token with it.",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("cpt_…")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Test the connection")
      .setDesc("Checks the address and token, and says which account they belong to.")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          button.setDisabled(true);
          try {
            const client = new ChronoplotClient(
              this.plugin.settings.serverUrl,
              this.plugin.settings.token,
            );
            const user = await client.whoami();
            this.projects = await client.projects();
            new Notice(`Connected as ${user.name} (${this.projects.length} projects).`);
            this.display();
          } catch (error) {
            new Notice(`Could not connect: ${error instanceof Error ? error.message : error}`);
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    /* ------------------------------------------------------- behaviour -- */

    new Setting(containerEl).setName("Behaviour").setHeading();

    new Setting(containerEl)
      .setName("Property prefix")
      .setDesc(
        `Frontmatter keys to look for. With "${this.plugin.settings.propertyPrefix}" ` +
          `a note uses ${this.plugin.settings.propertyPrefix}-start and ` +
          `${this.plugin.settings.propertyPrefix}-end.`,
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.propertyPrefix).onChange(async (value) => {
          this.plugin.settings.propertyPrefix = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sync after saving a note")
      .setDesc("Debounced, so a burst of edits results in one sync.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
          this.plugin.settings.syncOnSave = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sync every N minutes")
      .setDesc("0 turns it off.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const minutes = Number(value);
            this.plugin.settings.syncIntervalMinutes =
              Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : 0;
            await this.plugin.saveSettings();
            this.plugin.restartTimer();
          }),
      );

    /* -------------------------------------------------------- bindings -- */

    new Setting(containerEl)
      .setName("Projects")
      .setDesc(
        "Which notes feed which timeline. A note matched by two projects appears on both, " +
          "which is deliberate - one milestone can belong to two roadmaps.",
      )
      .setHeading()
      .addButton((button) =>
        button
          .setButtonText("Add project")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.bindings.push({
              projectId: "",
              projectTitle: "",
              include: [],
              exclude: [],
              laneStrategy: "property",
              defaultLane: "",
            });
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.bindings.length === 0) {
      containerEl.createEl("p", {
        text: "No projects yet. Test the connection first, then add one.",
        cls: "setting-item-description",
      });
    }

    this.plugin.settings.bindings.forEach((binding, index) => {
      this.renderBinding(containerEl, binding, index);
    });
  }

  private renderBinding(parent: HTMLElement, binding: Binding, index: number): void {
    const box = parent.createDiv({ cls: "setting-item" });
    box.style.display = "block";
    box.style.borderTop = "1px solid var(--background-modifier-border)";

    new Setting(box)
      .setName(binding.projectTitle || `Project ${index + 1}`)
      .addDropdown((dropdown) => {
        // Keep whatever is configured selectable even before a connection
        // test, so opening settings offline does not silently drop it.
        if (binding.projectId && !this.projects.some((p) => p.id === binding.projectId)) {
          dropdown.addOption(binding.projectId, binding.projectTitle || binding.projectId);
        }
        dropdown.addOption("", "Choose a project…");
        for (const project of this.projects) {
          dropdown.addOption(project.id, project.title);
        }

        dropdown.setValue(binding.projectId).onChange(async (value) => {
          binding.projectId = value;
          binding.projectTitle = this.projects.find((p) => p.id === value)?.title ?? "";
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("trash")
          .setTooltip("Remove")
          .onClick(async () => {
            this.plugin.settings.bindings.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const pathList = (
      label: string,
      description: string,
      value: string[],
      assign: (next: string[]) => void,
    ): void => {
      new Setting(box)
        .setName(label)
        .setDesc(description)
        .addTextArea((area) => {
          area.inputEl.rows = 3;
          area.inputEl.style.width = "100%";
          area.setValue(value.join("\n")).onChange(async (raw) => {
            assign(
              raw
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            );
            await this.plugin.saveSettings();
          });
        });
    };

    pathList(
      "Include",
      "One path per line, relative to the vault. A folder includes everything beneath it.",
      binding.include,
      (next) => (binding.include = next),
    );

    pathList(
      "Exclude",
      "Also one per line. Excludes win, so a folder can be included with holes in it.",
      binding.exclude,
      (next) => (binding.exclude = next),
    );

    new Setting(box)
      .setName("Lane")
      .setDesc("Where a card lands. A note's own lane property always wins.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("property", "From the note, else the default below")
          .addOption("folder", "From the note's folder name")
          .addOption("fixed", "Always the default below")
          .setValue(binding.laneStrategy)
          .onChange(async (value) => {
            binding.laneStrategy = value as Binding["laneStrategy"];
            await this.plugin.saveSettings();
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("Default lane")
          .setValue(binding.defaultLane)
          .onChange(async (value) => {
            binding.defaultLane = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
