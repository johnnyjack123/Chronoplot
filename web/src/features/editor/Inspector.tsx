import type { ReactNode } from "react";
import type { Granularity, Precision, ThemeName, TimelineDoc } from "@shared";
import { cn } from "@/lib/cn";
import { formatWithPrecision, snapToPrecision } from "@/lib/dates";
import { commands, useEditorStore } from "@/state/editor-store";
import { THEMES, useThemeStore } from "@/state/theme";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented, Select, Switch } from "@/components/ui/Controls";
import { Tooltip } from "@/components/ui/Popover";
import { CopyIcon, LinkIcon, TrashIcon, XIcon } from "@/components/icons";
import { CARD_SLOTS, SLOT_NAMES, cardFill } from "@/features/timeline/colors";

/*
 * The right-hand panel.
 *
 * The timeline's own settings are the resting state - they are always what you
 * fall back to. Selecting a card, lane or group lays that item's panel over the
 * top, and its close button takes you straight back. Without that button a
 * selection was a trap: nothing on screen returned you to the global settings.
 */
export function Inspector({ doc, readOnly }: { doc: TimelineDoc; readOnly: boolean }) {
  const selection = useEditorStore((state) => state.selection);
  const select = useEditorStore((state) => state.select);

  const active = (() => {
    if (selection.kind === "item") {
      const item = doc.items.find((candidate) => candidate.id === selection.id);
      if (!item) return null;
      return {
        eyebrow: item.kind === "milestone" ? "Milestone" : "Card",
        title: item.title || "Untitled",
        body: <ItemInspector doc={doc} itemId={item.id} readOnly={readOnly} />,
      };
    }
    if (selection.kind === "row") {
      const row = doc.rows.find((candidate) => candidate.id === selection.id);
      if (!row) return null;
      return {
        eyebrow: "Lane",
        title: row.title || "Untitled lane",
        body: <RowInspector doc={doc} rowId={row.id} readOnly={readOnly} />,
      };
    }
    if (selection.kind === "group") {
      const group = doc.groups.find((candidate) => candidate.id === selection.id);
      if (!group) return null;
      return {
        eyebrow: "Group",
        title: group.title || "Untitled group",
        body: <GroupInspector groupId={group.id} readOnly={readOnly} />,
      };
    }
    return null;
  })();

  return (
    <aside
      className="flex shrink-0 flex-col overflow-y-auto border-l border-line bg-surface"
      style={{ width: "var(--inspector-width)" }}
    >
      {active ? (
        <>
          <header className="sticky top-0 z-10 flex items-start gap-2 border-b border-line bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-micro uppercase text-ink-subtle">{active.eyebrow}</p>
              <h2 className="truncate-1 text-heading text-ink">{active.title}</h2>
            </div>
            <Tooltip content="Back to timeline settings (Esc)">
              <IconButton
                label="Close and show timeline settings"
                size="sm"
                onClick={() => select({ kind: "none" })}
              >
                <XIcon />
              </IconButton>
            </Tooltip>
          </header>
          {active.body}
        </>
      ) : (
        <TimelineSettings doc={doc} readOnly={readOnly} />
      )}
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0">
      <h3 className="text-micro uppercase text-ink-subtle">{title}</h3>
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

  /*
   * One past the lane's current sub-lanes, so the list can move a card down to
   * a new one. The lane grows to match when that choice is taken, which is the
   * same thing dragging past the last sub-lane does.
   */
  const row = doc.rows.find((candidate) => candidate.id === item.rowId);
  const subLaneChoices =
    Math.max(
      row?.subLanes ?? 1,
      doc.items
        .filter((candidate) => candidate.rowId === item.rowId)
        .reduce((most, candidate) => Math.max(most, (candidate.subLane ?? 0) + 1), 1),
    ) + 1;

  return (
    <>
      <PanelSection title="Details">
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

      <PanelSection title="Sub-lane">
        <Field label="Sub-lane" hideLabel>
          {(props) => (
            <Select
              {...props}
              value={item.subLane === undefined ? "auto" : String(item.subLane)}
              onChange={(value) =>
                commands.setSubLane(itemId, value === "auto" ? null : Number(value))
              }
              options={[
                { value: "auto", label: "Automatic" },
                ...Array.from({ length: subLaneChoices }, (_, index) => ({
                  value: String(index),
                  label: `Sub-lane ${index + 1}`,
                })),
              ]}
            />
          )}
        </Field>
        <p className="text-caption text-ink-subtle">
          {item.subLane === undefined
            ? "Arranged automatically - it drops to a new sub-lane only when it would overlap something."
            : "Pinned. It stays on this sub-lane and the automatic cards arrange themselves around it."}
        </p>
      </PanelSection>

      {item.source ? (
        <PanelSection title="From Obsidian">
          <p className="truncate-1 text-caption text-ink-subtle" title={item.source.path}>
            {item.source.vault} · {item.source.path}
          </p>
          {item.source.url ? (
            <Button
              icon={<LinkIcon />}
              onClick={() => {
                // A custom scheme, so the browser hands it to the OS. It only
                // works where Obsidian is installed and that vault exists.
                window.location.href = item.source!.url!;
              }}
            >
              Open the note
            </Button>
          ) : null}
          <p className="text-caption text-ink-subtle">
            The note owns this card's title and dates — edit them there. Colour and lane are
            yours and survive a re-sync.
          </p>
        </PanelSection>
      ) : null}

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
            <DatePicker
              {...props}
              disabled={disabled}
              value={item.start}
              precision={item.precision}
              edge="start"
              min={doc.settings.start}
              max={doc.settings.end}
              onChange={(next) => {
                commands.updateItem(itemId, {
                  start: next,
                  ...(item.kind === "milestone" || item.end < next ? { end: next } : {}),
                });
              }}
            />
          )}
        </Field>

        {item.kind === "bar" ? (
          <Field label="End">
            {(props) => (
              <DatePicker
                {...props}
                disabled={disabled}
                value={item.end}
                precision={item.precision}
                edge="end"
                min={item.start}
                max={doc.settings.end}
                onChange={(next) => commands.updateItem(itemId, { end: next })}
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
                <li
                  key={link.id}
                  className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent-soft/60"
                >
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

      <PanelSection title="Lane colour">
        <div className="grid grid-cols-10 gap-1.5">
          {/* Clearing the colour is a swatch of its own rather than a separate
              button - it belongs in the same row of choices. */}
          <Tooltip content="No colour">
            <button
              type="button"
              disabled={readOnly}
              aria-label="No colour"
              aria-pressed={row.color === undefined}
              onClick={() => commands.setRowColor(rowId, undefined)}
              className={cn(
                "flex size-6 items-center justify-center rounded-sm border border-line",
                "transition-transform duration-[var(--dur-instant)] ease-standard",
                "hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50",
                row.color === undefined &&
                  "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]",
              )}
            >
              <XIcon className="size-3 text-ink-subtle" />
            </button>
          </Tooltip>

          {CARD_SLOTS.map((slot) => (
            <Tooltip key={slot} content={SLOT_NAMES[slot]}>
              <button
                type="button"
                disabled={readOnly}
                aria-label={SLOT_NAMES[slot]}
                aria-pressed={row.color === slot}
                onClick={() => commands.setRowColor(rowId, slot)}
                className={cn(
                  "size-6 rounded-sm transition-transform duration-[var(--dur-instant)] ease-standard",
                  "hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50",
                  row.color === slot &&
                    "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]",
                )}
                style={{ backgroundColor: cardFill(slot) }}
              />
            </Tooltip>
          ))}
        </div>
        <p className="text-caption text-ink-subtle">
          Washes the whole lane. Kept faint on purpose, so cards still read as
          the foreground.
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
  const { setOverride, override } = useThemeStore();
  const snapping = useEditorStore((state) => state.snapping);
  const setSnapping = useEditorStore((state) => state.setSnapping);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3">
        <p className="text-micro uppercase text-ink-subtle">Timeline</p>
        <h2 className="text-heading text-ink">Settings</h2>
      </header>

      <PanelSection title="Range">
        <Field label="From">
          {(props) => (
            <DatePicker
              {...props}
              disabled={readOnly}
              value={doc.settings.start}
              edge="start"
              max={doc.settings.end}
              onChange={(start) => commands.updateSettings({ start })}
            />
          )}
        </Field>
        <Field label="To">
          {(props) => (
            <DatePicker
              {...props}
              disabled={readOnly}
              value={doc.settings.end}
              edge="end"
              min={doc.settings.start}
              onChange={(end) => commands.updateSettings({ end })}
            />
          )}
        </Field>
        <Button
          disabled={readOnly || doc.items.length === 0}
          onClick={() => commands.fitWindowToItems()}
        >
          Fit to content
        </Button>
      </PanelSection>

      <PanelSection title="Axis">
        <Field label="Finest ticks" hint="Coarser units take over automatically as you zoom out.">
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
          hint="Only drawn once days are wide enough to see."
        />
        <Switch
          checked={doc.settings.showLinks}
          onChange={(showLinks) => commands.updateSettings({ showLinks })}
          label="Dependency arrows"
        />
      </PanelSection>

      <PanelSection title="Editing">
        <Switch
          checked={snapping}
          onChange={setSnapping}
          label="Snap to other cards"
          hint="Dragged edges latch onto neighbouring cards and today. Yours only, not part of the project."
        />
      </PanelSection>

      <PanelSection title="Project theme">
        <Select<ThemeName>
          value={doc.settings.theme}
          onChange={(theme) => {
            /*
             * Drop any personal override first. Choosing the project theme is a
             * statement about how this timeline should look, and the override
             * silently outranks it - which is why the control appeared to do
             * nothing for anyone who had used the theme switcher. Applying the
             * theme itself is the editor's job, driven by the document.
             */
            setOverride(null);
            commands.updateSettings({ theme });
          }}
          options={THEMES.map((theme) => ({
            value: theme.name,
            label: theme.label,
            hint: theme.blurb,
          }))}
        />
        <p className="text-caption text-ink-subtle">
          {override && override !== doc.settings.theme
            ? "You are previewing a different theme locally; picking one here applies it for everyone and clears your preview."
            : "Everyone who opens this project sees this theme."}
        </p>
      </PanelSection>
    </>
  );
}
