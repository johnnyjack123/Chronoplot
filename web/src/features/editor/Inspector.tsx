import type { Granularity, Precision, ThemeName, TimelineDoc } from "@shared";
import { cn } from "@/lib/cn";
import { formatWithPrecision, isValidIso, snapToPrecision } from "@/lib/dates";
import { commands, useEditorStore } from "@/state/editor-store";
import { THEMES, useThemeStore } from "@/state/theme";
import { Button, IconButton } from "@/components/ui/Button";
import { DateInput, Field, Input, Textarea } from "@/components/ui/Field";
import { Segmented, Select, Switch } from "@/components/ui/Controls";
import { Tooltip } from "@/components/ui/Popover";
import { CopyIcon, LinkIcon, TrashIcon } from "@/components/icons";
import { CARD_SLOTS, SLOT_NAMES, cardFill } from "@/features/timeline/colors";

/*
 * The right-hand properties panel. What it shows follows the selection, and
 * with nothing selected it falls back to the timeline's own settings - so the
 * panel is never empty and there is never a separate "settings" mode to find.
 */
export function Inspector({ doc, readOnly }: { doc: TimelineDoc; readOnly: boolean }) {
  const selection = useEditorStore((state) => state.selection);

  const body = (() => {
    if (selection.kind === "item") {
      const item = doc.items.find((candidate) => candidate.id === selection.id);
      return item ? <ItemInspector doc={doc} itemId={item.id} readOnly={readOnly} /> : null;
    }
    if (selection.kind === "row") {
      const row = doc.rows.find((candidate) => candidate.id === selection.id);
      return row ? <RowInspector doc={doc} rowId={row.id} readOnly={readOnly} /> : null;
    }
    if (selection.kind === "group") {
      const group = doc.groups.find((candidate) => candidate.id === selection.id);
      return group ? <GroupInspector groupId={group.id} readOnly={readOnly} /> : null;
    }
    return null;
  })();

  return (
    <aside
      className="flex shrink-0 flex-col overflow-y-auto border-l border-line bg-surface"
      style={{ width: "var(--inspector-width)" }}
    >
      {body ?? <TimelineSettings doc={doc} readOnly={readOnly} />}
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0">
      <h2 className="text-micro uppercase text-ink-subtle">{title}</h2>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ item -- */

function ItemInspector({
  doc,
  itemId,
  readOnly,
}: {
  doc: TimelineDoc;
  itemId: string;
  readOnly: boolean;
}) {
  const item = doc.items.find((candidate) => candidate.id === itemId);
  const select = useEditorStore((state) => state.select);
  if (!item) return null;

  const links = doc.links.filter((link) => link.fromId === itemId || link.toId === itemId);
  const disabled = readOnly;

  return (
    <>
      <PanelSection title={item.kind === "milestone" ? "Milestone" : "Card"}>
        <Field label="Title">
          {(props) => (
            <Input
              {...props}
              disabled={disabled}
              value={item.title}
              onChange={(event) =>
                commands.updateItem(itemId, { title: event.target.value }, `title:${itemId}`)
              }
            />
          )}
        </Field>

        <Field label="Notes" hint="Only visible here, never on the plot.">
          {(props) => (
            <Textarea
              {...props}
              disabled={disabled}
              value={item.notes ?? ""}
              placeholder="Context, owner, open questions…"
              onChange={(event) =>
                commands.updateItem(itemId, { notes: event.target.value }, `notes:${itemId}`)
              }
            />
          )}
        </Field>
      </PanelSection>

      <PanelSection title="Colour">
        <div className="grid grid-cols-9 gap-1.5">
          {CARD_SLOTS.map((slot) => (
            <Tooltip key={slot} content={SLOT_NAMES[slot]}>
              <button
                type="button"
                disabled={disabled}
                aria-label={SLOT_NAMES[slot]}
                aria-pressed={item.color === slot}
                onClick={() => commands.updateItem(itemId, { color: slot })}
                className={cn(
                  "size-6 rounded-sm transition-transform duration-[var(--dur-instant)] ease-standard",
                  "hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50",
                  item.color === slot &&
                    "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]",
                )}
                style={{ backgroundColor: cardFill(slot) }}
              />
            </Tooltip>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Dates">
        <Field label="Precision" hint="Controls how dragging snaps and how dates are labelled.">
          {() => (
            <Segmented<Precision>
              value={item.precision}
              onChange={(precision) => {
                // Re-snap the existing dates so what is stored matches the new
                // precision immediately, rather than at the next drag.
                commands.updateItem(itemId, {
                  precision,
                  start: snapToPrecision(item.start, precision, "start"),
                  end:
                    item.kind === "milestone"
                      ? snapToPrecision(item.start, precision, "start")
                      : snapToPrecision(item.end, precision, "end"),
                });
              }}
              options={[
                { value: "day", label: "Day" },
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
            />
          )}
        </Field>

        <Field label={item.kind === "milestone" ? "Date" : "Start"}>
          {(props) => (
            <DateInput
              {...props}
              disabled={disabled}
              value={item.start}
              min={doc.settings.start}
              max={doc.settings.end}
              onChange={(event) => {
                const value = event.target.value;
                if (!isValidIso(value)) return;
                const start = snapToPrecision(value, item.precision, "start");
                commands.updateItem(itemId, {
                  start,
                  ...(item.kind === "milestone" || item.end < start ? { end: start } : {}),
                });
              }}
            />
          )}
        </Field>

        {item.kind === "bar" ? (
          <Field label="End">
            {(props) => (
              <DateInput
                {...props}
                disabled={disabled}
                value={item.end}
                min={item.start}
                max={doc.settings.end}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!isValidIso(value)) return;
                  commands.updateItem(itemId, {
                    end: snapToPrecision(value, item.precision, "end"),
                  });
                }}
              />
            )}
          </Field>
        ) : null}

        <p className="text-caption text-ink-subtle">
          {item.kind === "milestone"
            ? formatWithPrecision(item.start, item.precision)
            : `${formatWithPrecision(item.start, item.precision)} – ${formatWithPrecision(item.end, item.precision)}`}
        </p>
      </PanelSection>

      {item.kind === "bar" ? (
        <PanelSection title="Progress">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={disabled}
              value={Math.round((item.progress ?? 0) * 100)}
              onChange={(event) =>
                commands.updateItem(
                  itemId,
                  { progress: Number(event.target.value) / 100 },
                  `progress:${itemId}`,
                )
              }
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-sunken accent-[var(--accent)]"
            />
            <span className="tabular w-10 text-right text-caption text-ink-muted">
              {Math.round((item.progress ?? 0) * 100)}%
            </span>
          </div>
        </PanelSection>
      ) : null}

      {links.length > 0 ? (
        <PanelSection title={`Links (${links.length})`}>
          <ul className="flex flex-col gap-1">
            {links.map((link) => {
              const otherId = link.fromId === itemId ? link.toId : link.fromId;
              const other = doc.items.find((candidate) => candidate.id === otherId);
              return (
                <li key={link.id} className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent-soft/60">
                  <LinkIcon className="size-3.5 shrink-0 text-ink-subtle" />
                  <button
                    type="button"
                    onClick={() => select({ kind: "item", id: otherId })}
                    className="min-w-0 flex-1 truncate-1 text-left text-caption text-ink hover:text-accent"
                  >
                    {link.fromId === itemId ? "→ " : "← "}
                    {other?.title ?? "Unknown"}
                  </button>
                  {!disabled ? (
                    <IconButton
                      label="Remove link"
                      size="sm"
                      className="size-6"
                      onClick={() => commands.unlink(link.id)}
                    >
                      <TrashIcon className="size-3.5" />
                    </IconButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </PanelSection>
      ) : null}

      {!disabled ? (
        <PanelSection title="Actions">
          <div className="flex gap-2">
            <Button
              icon={<CopyIcon />}
              className="flex-1"
              onClick={() => {
                const id = commands.duplicateItem(itemId);
                if (id) select({ kind: "item", id });
              }}
            >
              Duplicate
            </Button>
            <Button
              variant="danger"
              icon={<TrashIcon />}
              className="flex-1"
              onClick={() => {
                commands.removeItem(itemId);
                select({ kind: "none" });
              }}
            >
              Delete
            </Button>
          </div>
        </PanelSection>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------- row -- */

function RowInspector({
  doc,
  rowId,
  readOnly,
}: {
  doc: TimelineDoc;
  rowId: string;
  readOnly: boolean;
}) {
  const row = doc.rows.find((candidate) => candidate.id === rowId);
  const select = useEditorStore((state) => state.select);
  if (!row) return null;

  const itemCount = doc.items.filter((item) => item.rowId === rowId).length;

  return (
    <>
      <PanelSection title="Lane">
        <Field label="Name">
          {(props) => (
            <Input
              {...props}
              disabled={readOnly}
              value={row.title}
              onChange={(event) => commands.renameRow(rowId, event.target.value)}
            />
          )}
        </Field>

        <Field label="Group">
          {(props) => (
            <Select
              {...props}
              value={row.groupId ?? "__none"}
              onChange={(value) => commands.setRowGroup(rowId, value === "__none" ? null : value)}
              options={[
                { value: "__none", label: "No group" },
                ...doc.groups.map((group) => ({ value: group.id, label: group.title })),
              ]}
            />
          )}
        </Field>

        <p className="text-caption text-ink-subtle">
          {itemCount} card{itemCount === 1 ? "" : "s"} on this lane.
        </p>
      </PanelSection>

      {!readOnly ? (
        <PanelSection title="Actions">
          <Button
            variant="danger"
            icon={<TrashIcon />}
            onClick={() => {
              commands.removeRow(rowId);
              select({ kind: "none" });
            }}
          >
            Delete lane{itemCount > 0 ? ` and ${itemCount} card${itemCount === 1 ? "" : "s"}` : ""}
          </Button>
        </PanelSection>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- group -- */

function GroupInspector({ groupId, readOnly }: { groupId: string; readOnly: boolean }) {
  const doc = useEditorStore((state) => state.doc);
  const select = useEditorStore((state) => state.select);
  const group = doc?.groups.find((candidate) => candidate.id === groupId);
  if (!group) return null;

  return (
    <>
      <PanelSection title="Group">
        <Field label="Name">
          {(props) => (
            <Input
              {...props}
              disabled={readOnly}
              value={group.title}
              onChange={(event) => commands.renameGroup(groupId, event.target.value)}
            />
          )}
        </Field>
        <Switch
          checked={group.collapsed}
          onChange={() => commands.toggleGroup(groupId)}
          label="Collapsed"
          hint="Hides its lanes without deleting anything."
        />
      </PanelSection>

      {!readOnly ? (
        <PanelSection title="Actions">
          <Button
            variant="danger"
            icon={<TrashIcon />}
            onClick={() => {
              commands.removeGroup(groupId);
              select({ kind: "none" });
            }}
          >
            Delete group
          </Button>
          <p className="text-caption text-ink-subtle">
            Its lanes are kept and move back to the top level.
          </p>
        </PanelSection>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------- settings -- */

function TimelineSettings({ doc, readOnly }: { doc: TimelineDoc; readOnly: boolean }) {
  const { setProjectTheme, override } = useThemeStore();

  return (
    <>
      <PanelSection title="Timeline range">
        <Field label="From">
          {(props) => (
            <DateInput
              {...props}
              disabled={readOnly}
              value={doc.settings.start}
              onChange={(event) =>
                isValidIso(event.target.value) &&
                commands.updateSettings({ start: event.target.value })
              }
            />
          )}
        </Field>
        <Field label="To">
          {(props) => (
            <DateInput
              {...props}
              disabled={readOnly}
              value={doc.settings.end}
              onChange={(event) =>
                isValidIso(event.target.value) && commands.updateSettings({ end: event.target.value })
              }
            />
          )}
        </Field>
        <Button disabled={readOnly || doc.items.length === 0} onClick={() => commands.fitWindowToItems()}>
          Fit to content
        </Button>
      </PanelSection>

      <PanelSection title="Axis">
        <Field label="Ticks">
          {() => (
            <Segmented<Granularity>
              value={doc.settings.granularity}
              onChange={(granularity) => commands.updateSettings({ granularity })}
              size="sm"
              options={[
                { value: "day", label: "D", title: "Days" },
                { value: "week", label: "W", title: "Weeks" },
                { value: "month", label: "M", title: "Months" },
                { value: "quarter", label: "Q", title: "Quarters" },
                { value: "year", label: "Y", title: "Years" },
              ]}
            />
          )}
        </Field>

        <Switch
          checked={doc.settings.showToday}
          onChange={(showToday) => commands.updateSettings({ showToday })}
          label="Today marker"
        />
        <Switch
          checked={doc.settings.showWeekends}
          onChange={(showWeekends) => commands.updateSettings({ showWeekends })}
          label="Shade weekends"
          hint="Only drawn when the axis ticks in days."
        />
        <Switch
          checked={doc.settings.showLinks}
          onChange={(showLinks) => commands.updateSettings({ showLinks })}
          label="Dependency arrows"
        />
      </PanelSection>

      <PanelSection title="Project theme">
        <Select<ThemeName>
          value={doc.settings.theme}
          onChange={(theme) => {
            commands.updateSettings({ theme });
            setProjectTheme(theme);
          }}
          options={THEMES.map((theme) => ({
            value: theme.name,
            label: theme.label,
            hint: theme.blurb,
          }))}
        />
        <p className="text-caption text-ink-subtle">
          {override
            ? "You are previewing a different theme locally. This setting is what everyone else sees."
            : "Everyone who opens this project sees this theme."}
        </p>
      </PanelSection>
    </>
  );
}
