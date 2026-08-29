import { useMemo, useState } from "react";
import type { ThemeName, TimelineDoc } from "@shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Segmented, Select, Switch } from "@/components/ui/Controls";
import { THEMES } from "@/state/theme";
import { DownloadIcon } from "@/components/icons";
import {
  PAGE_SIZES, planPages,
  type ExportOptions, type Orientation, type PageSize,
} from "./pdf-plan";

/*
 * Scale presets, expressed in millimetres per day. "Fit" is a null scale, which
 * the planner turns into whatever makes the timeline exactly one page wide.
 */
const SCALE_PRESETS: { key: string; label: string; mmPerDay: number | null; hint: string }[] = [
  { key: "fit", label: "Fit to one page", mmPerDay: null, hint: "Whole timeline across a single page width." },
  { key: "compact", label: "Compact", mmPerDay: 0.35, hint: "About a year per A4 landscape page." },
  { key: "comfortable", label: "Comfortable", mmPerDay: 0.9, hint: "About five months per page." },
  { key: "detailed", label: "Detailed", mmPerDay: 2.5, hint: "About seven weeks per page." },
  { key: "daily", label: "Day by day", mmPerDay: 6, hint: "Individual days are legible." },
];

export function ExportDialog({
  open,
  onOpenChange,
  doc,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: TimelineDoc;
  title: string;
}) {
  const [format, setFormat] = useState<"pdf" | "html">("pdf");
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [scaleKey, setScaleKey] = useState("fit");
  // Light themes print better on paper, so the export defaults to one rather
  // than to whatever the editor happens to be showing.
  const [theme, setTheme] = useState<ThemeName>("daylight");
  const [repeatLaneLabels, setRepeatLaneLabels] = useState(true);
  const [showToday, setShowToday] = useState(doc.settings.showToday);
  const [busy, setBusy] = useState(false);

  const options: ExportOptions = useMemo(
    () => ({
      pageSize,
      orientation,
      mmPerDay: SCALE_PRESETS.find((preset) => preset.key === scaleKey)?.mmPerDay ?? null,
      theme,
      title,
      repeatLaneLabels,
      showToday,
    }),
    [orientation, pageSize, repeatLaneLabels, scaleKey, showToday, theme, title],
  );

  // Recomputed on every option change, so the page count is never a surprise.
  const plan = useMemo(() => {
    try {
      return planPages(doc, options);
    } catch {
      return null;
    }
  }, [doc, options]);

  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (format === "html") {
        const { exportHtml } = await import("./html-export");
        exportHtml(doc, { title, theme, showLaneLabels: repeatLaneLabels });
      } else {
        // jsPDF is pulled in only now, so opening the editor never pays for it.
        const { exportPdf } = await import("./pdf-render");
        await exportPdf(doc, options);
      }
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The export could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  const preset = SCALE_PRESETS.find((entry) => entry.key === scaleKey);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export"
      description={
        format === "pdf"
          ? "Vector output - text stays selectable and nothing pixelates when printed."
          : "A single HTML file with no external dependencies, safe to embed anywhere."
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon={<DownloadIcon />} loading={busy} onClick={() => void run()}>
            Export
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Format"
          hint={
            format === "pdf"
              ? "Vector pages for printing or sharing."
              : "One self-contained file you can open, embed in a page, or drop into Obsidian. Pan, zoom and hover for exact dates."
          }
        >
          {() => (
            <Segmented<"pdf" | "html">
              value={format}
              onChange={setFormat}
              options={[
                { value: "pdf", label: "PDF" },
                { value: "html", label: "Interactive HTML" },
              ]}
            />
          )}
        </Field>

        {format === "pdf" ? (
        <>
        <Field label="Page size">
          {() => (
            <Segmented<PageSize>
              value={pageSize}
              onChange={setPageSize}
              options={(Object.keys(PAGE_SIZES) as PageSize[]).map((key) => ({
                value: key,
                label: PAGE_SIZES[key].label,
              }))}
            />
          )}
        </Field>

        <Field label="Orientation">
          {() => (
            <Segmented<Orientation>
              value={orientation}
              onChange={setOrientation}
              options={[
                { value: "landscape", label: "Landscape" },
                { value: "portrait", label: "Portrait" },
              ]}
            />
          )}
        </Field>

        <Field label="Scale" hint={preset?.hint}>
          {(props) => (
            <Select
              {...props}
              value={scaleKey}
              onChange={setScaleKey}
              options={SCALE_PRESETS.map((entry) => ({ value: entry.key, label: entry.label }))}
            />
          )}
        </Field>
        </>
        ) : null}

        <Field
          label="Colours"
          hint={
            format === "pdf"
              ? "Light themes use less ink and read better on paper."
              : "The exported file carries this theme's colours with it."
          }
        >
          {(props) => (
            <Select<ThemeName>
              {...props}
              value={theme}
              onChange={setTheme}
              options={THEMES.map((entry) => ({
                value: entry.name,
                label: entry.label,
                hint: entry.mode === "light" ? "Light" : "Dark",
              }))}
            />
          )}
        </Field>

        <div className="flex flex-col gap-1 rounded-md border border-line bg-sunken p-3">
          <Switch
            checked={repeatLaneLabels}
            onChange={setRepeatLaneLabels}
            label={format === "pdf" ? "Repeat lane names on every page" : "Show lane names"}
            hint={format === "pdf" ? "Keeps a multi-page timeline readable." : undefined}
          />
          {format === "pdf" ? (
            <Switch checked={showToday} onChange={setShowToday} label="Draw the today marker" />
          ) : null}
        </div>

        {/*
          The page count is the thing people actually want to know before they
          hit export, so it is stated plainly rather than hidden behind a
          preview.
        */}
        {format === "pdf" && plan ? (
          <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
            <p className="text-body text-ink">
              <span className="tabular font-semibold">{plan.totalPages}</span>{" "}
              page{plan.totalPages === 1 ? "" : "s"}
              {plan.totalPages > 1 ? (
                <span className="text-ink-muted">
                  {" "}
                  · {plan.columns.length} across × {plan.rows.length} down
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-caption text-ink-subtle">
              {plan.columns.length > 1
                ? "Pages break on calendar boundaries where one is close enough to the page edge."
                : "The whole timeline fits one page width."}
            </p>
          </div>
        ) : format === "pdf" ? (
          <p className="text-caption text-critical">This combination cannot be laid out.</p>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-sm bg-critical/10 px-3 py-2 text-caption text-critical">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
