import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { commands, useEditorStore } from "@/state/editor-store";
import { useSyncStore, type SyncStatus } from "@/state/sync";
import { Button, IconButton } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Popover";
import { ThemeSwitcher } from "@/features/theme/ThemeSwitcher";
import {
  AlertIcon, ArrowLeftIcon, BarIcon, CheckIcon, CloudIcon, DownloadIcon, GroupIcon,
  PlusIcon, RedoIcon, ShareIcon, UndoIcon, ZoomInIcon, ZoomOutIcon,
} from "@/components/icons";

/** Zoom steps, so the buttons move by a sensible ratio rather than a fixed amount. */
const ZOOM_FACTOR = 1.5;

function SyncBadge({ status, message }: { status: SyncStatus; message: string | null }) {
  const config: Record<SyncStatus, { label: string; icon: React.ReactNode; tone: string }> = {
    idle: { label: "Up to date", icon: <CheckIcon />, tone: "text-ink-subtle" },
    pending: { label: "Unsaved changes", icon: <CloudIcon />, tone: "text-ink-muted" },
    saving: { label: "Saving…", icon: <CloudIcon />, tone: "text-ink-muted" },
    saved: { label: "Saved", icon: <CheckIcon />, tone: "text-good" },
    offline: { label: "Offline", icon: <AlertIcon />, tone: "text-warning" },
    conflict: { label: "Conflict", icon: <AlertIcon />, tone: "text-critical" },
    denied: { label: "Read-only", icon: <AlertIcon />, tone: "text-warning" },
  };
  const entry = config[status];

  return (
    <Tooltip content={message ?? entry.label}>
      <span
        // A live region so the state is announced rather than only shown.
        role="status"
        aria-live="polite"
        className={cn("flex items-center gap-1.5 px-1 text-caption", entry.tone)}
      >
        <span className="[&>svg]:size-3.5">{entry.icon}</span>
        <span className="hidden lg:inline">{entry.label}</span>
      </span>
    </Tooltip>
  );
}

export function Toolbar({
  onShare,
  onExport,
  readOnly,
}: {
  onShare: () => void;
  onExport: () => void;
  readOnly: boolean;
}) {
  const navigate = useNavigate();
  const { title, setTitle, unitsPerDay, setZoom, zoomToFit, undo, redo, past, future } =
    useEditorStore();
  const { status, message } = useSyncStore();

  return (
    <header className="flex h-[var(--rail-height)] shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <Tooltip content="Back to projects">
        <IconButton label="Back to projects" onClick={() => navigate("/")}>
          <ArrowLeftIcon />
        </IconButton>
      </Tooltip>

      <input
        value={title}
        disabled={readOnly}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="Project title"
        className={cn(
          "min-w-0 max-w-64 flex-shrink rounded-sm bg-transparent px-2 py-1 text-heading text-ink",
          "hover:bg-sunken focus:bg-sunken focus:outline-none focus:ring-2 focus:ring-accent/25",
          "disabled:cursor-default disabled:hover:bg-transparent",
        )}
      />

      <SyncBadge status={status} message={message} />

      <div className="mx-1 h-5 w-px shrink-0 bg-line" />

      <Tooltip content="Undo (Ctrl+Z)">
        <IconButton label="Undo" disabled={past.length === 0 || readOnly} onClick={undo}>
          <UndoIcon />
        </IconButton>
      </Tooltip>
      <Tooltip content="Redo (Ctrl+Shift+Z)">
        <IconButton label="Redo" disabled={future.length === 0 || readOnly} onClick={redo}>
          <RedoIcon />
        </IconButton>
      </Tooltip>

      <div className="mx-1 h-5 w-px shrink-0 bg-line" />

      <Button
        icon={<PlusIcon />}
        disabled={readOnly}
        onClick={() => commands.addRow()}
        className="hidden sm:inline-flex"
      >
        Lane
      </Button>
      <Tooltip content="Add a lane">
        <IconButton label="Add lane" disabled={readOnly} onClick={() => commands.addRow()} className="sm:hidden">
          <BarIcon />
        </IconButton>
      </Tooltip>
      <Tooltip content="Add a group">
        <IconButton label="Add group" disabled={readOnly} onClick={() => commands.addGroup()}>
          <GroupIcon />
        </IconButton>
      </Tooltip>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip content="Zoom out (Ctrl+−, or Ctrl+scroll)">
          <IconButton label="Zoom out" onClick={() => setZoom(unitsPerDay / ZOOM_FACTOR)}>
            <ZoomOutIcon />
          </IconButton>
        </Tooltip>
        <Tooltip content="Zoom in (Ctrl++, or Ctrl+scroll)">
          <IconButton label="Zoom in" onClick={() => setZoom(unitsPerDay * ZOOM_FACTOR)}>
            <ZoomInIcon />
          </IconButton>
        </Tooltip>
        <Tooltip content="Fit the whole timeline on screen (Ctrl+0)">
          <Button size="sm" onClick={zoomToFit}>
            Fit
          </Button>
        </Tooltip>

        <div className="mx-1 h-5 w-px shrink-0 bg-line" />

        <Tooltip content="Share">
          <IconButton label="Share" onClick={onShare}>
            <ShareIcon />
          </IconButton>
        </Tooltip>
        <ThemeSwitcher />
        <Button variant="primary" icon={<DownloadIcon />} onClick={onExport}>
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>
    </header>
  );
}
