import { useMemo, useState } from "react";
import type { ThemeName, TimelineDoc } from "@shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Segmented, Select, Switch } from "@/components/ui/Controls";
import { THEMES } from "@/state/theme";
import { useSessionStore } from "@/state/session";
import { DownloadIcon } from "@/components/icons";
import { downloadProjectFile } from "@/features/projects/project-file";
import {
  PAGE_SIZES, planPages,
  type ExportOptions, type Orientation, type PageSize,
} from "./pdf-plan";

type Format = "pdf" | "html" | "project";

/*
 * Scale presets, in millimetres per day. "Fit" is a null scale, which the
 * planner turns into whatever makes the timeline exactly one page wide.
 * "Custom" hands both axes over to the sliders below.
 */
const SCALE_PRESETS: { key: string; label: string; mmPerDay: number | null; hint: string }[] = [
  { key: "fit", label: "Fit to one page", mmPerDay: null, hint: "Whole timeline across a single page width." },
  { key: "compact", label: "Compact", mmPerDay: 0.35, hint: "About a year per A4 landscape page." },
  { key: "comfortable", label: "Comfortable", mmPerDay: 0.9, hint: "About five months per page." },
  { key: "detailed", label: "Detailed", mmPerDay: 2.5, hint: "About seven weeks per page." },
  { key: "daily", label: "Day by day", mmPerDay: 6, hint: "Individual days are legible." },
  { key: "custom", label: "Custom…", mmPerDay: null, hint: "Set both axes by hand." },
];

/**
 * The horizontal slider is exponential.
 *
 * Usable scales run from about 0.05 to 12 mm per day - a spread of more than
 * two hundred times. On a linear slider almost the entire travel would sit at
 * the wide end and the useful range would be a few pixels wide.
 */
const MIN_MM = 0.05;
const MAX_MM = 12;
const sliderToMm = (value: number): number => MIN_MM * Math.pow(MAX_MM / MIN_MM, value / 100);
const mmToSlider = (mm: number): number =>
  Math.round((Math.log(mm / MIN_MM) / Math.log(MAX_MM / MIN_MM)) * 100);

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
  const user = useSessionStore((state) => state.user);

  const [format, setFormat] = useState<Format>("pdf");
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [scaleKey, setScaleKey] = useState("fit");
  const [customMm, setCustomMm] = useState(1.2);
  const [verticalScale, setVerticalScale] = useState(1);
  // Light themes print better on paper, so the export defaults to one rather
  // than to whatever the editor happens to be showing.
  const [theme, setTheme] = useState<ThemeName>("daylight");
  const [repeatLaneLabels, setRepeatLaneLabels] = useState(true);
  const [showToday, setShowToday] = useState(doc.settings.showToday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = scaleKey === "custom";

  const options: ExportOptions = useMemo(
    () => ({
      pageSize,
      orientation,
      mmPerDay: isCustom
        ? customMm
        : (SCALE_PRESETS.find((preset) => preset.key === scaleKey)?.mmPerDay ?? null),
      verticalScale: isCustom ? verticalScale : 1,
      theme,
      title,
      repeatLaneLabels,
      showToday,
    }),
    [customMm, isCustom, orientation, pageSize, repeatLaneLabels, scaleKey, showToday, theme, title, verticalScale],
  );

  // Recomputed on every option change, so the page count is never a surprise.
  const plan = useMemo(() => {
    try {
      return planPages(doc, options);
    } catch {
      return null;
    }
  }, [doc, options]);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (format === "project") {
        downloadProjectFile(title, doc, user?.name);
      } else if (format === "html") {
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

  const description =
    format === "pdf"
      ? "Vector output - text stays selectable and nothing pixelates when printed."
      : format === "html"
        ? "A single HTML file with no external dependencies, safe to embed anywhere."
        : "The timeline itself, to open on another Chronoplot instance.";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export"
      description={description}
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
        <Field label="Format">
          {() => (
            <Segmented<Format>
              value={format}
              onChange={setFormat}
              options={[
                { value: "pdf", label: "PDF" },
                { value: "html", label: "Interactive HTML" },
                { value: "project", label: "Project file" },
              ]}
            />
          )}
        </Field>

        {format === "project" ? (
          <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
            <p className="text-body text-ink">
              Downloads a <code className="text-ink-muted">.chronoplot.json</code> file.
            </p>
            <p className="mt-1 text-caption text-ink-subtle">
              It holds the timeline and nothing else - no accounts, no sharing, no server
              addresses. Import it from the dashboard of any Chronoplot instance.
            </p>
          </div>
        ) : null}

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

            {isCustom ? (
              <div className="flex flex-col gap-4 rounded-md border border-line bg-sunken p-3">
                <ScaleSlider
                  label="Horizontal"
                  value={mmToSlider(customMm)}
                  onChange={(next) => setCustomMm(sliderToMm(next))}
                  readout={`${customMm.toFixed(2)} mm per day`}
                  detail={`${Math.round(210 / customMm)} days across an A4 width`}
                />
                <ScaleSlider
                  label="Vertical"
                  value={Math.round(((verticalScale - 0.5) / 2.5) * 100)}
                  onChange={(next) => setVerticalScale(0.5 + (next / 100) * 2.5)}
                  readout={`${verticalScale.toFixed(2)}×`}
                  detail="Lane and bar heights. Text size is unchanged."
                />
              </div>
            ) : null}

            <Field label="Colours" hint="Light themes use less ink and read better on paper.">
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
          </>
        ) : null}

        {format === "html" ? (
          <Field label="Colours" hint="The exported file carries this theme's colours with it.">
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
        ) : null}

        {format !== "project" ? (
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
        ) : null}

        {/*
          The page count is the thing people actually want to know before they
          hit export, so it is stated plainly rather than hidden behind a
          preview - and it updates as the sliders move.
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

function ScaleSlider({
  label,
  value,
  onChange,
  readout,
  detail,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  readout: string;
  detail: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between">
        <span className="text-label text-ink">{label}</span>
        <span className="tabular text-caption text-ink-muted">{readout}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.min(100, Math.max(0, value))}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line-strong accent-[var(--accent)]"
      />
      <span className="text-caption text-ink-subtle">{detail}</span>
    </label>
  );
}
