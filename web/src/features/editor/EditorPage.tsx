import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "@/lib/api";
import { commands, useEditorStore } from "@/state/editor-store";
import { useSyncEngine, useSyncStore } from "@/state/sync";
import { useThemeStore } from "@/state/theme";
import { Button } from "@/components/ui/Button";
import { ChronoplotMark, PlusIcon } from "@/components/icons";
import { TimelineCanvas } from "@/features/timeline/TimelineCanvas";
import { ExportDialog } from "@/features/export/ExportDialog";
import { Inspector } from "./Inspector";
import { Toolbar } from "./Toolbar";
import { ShareDialog } from "./ShareDialog";
import { ConflictDialog } from "./ConflictDialog";
import { useShortcuts } from "./useShortcuts";

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const { doc, role, load, reset } = useEditorStore();
  const setProjectTheme = useThemeStore((state) => state.setProjectTheme);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const readOnly = role === "viewer";

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const { project } = await api.getProject(projectId);
        if (cancelled) {
          return;
        }
        load({
          projectId: project.id,
          title: project.title,
          doc: project.doc,
          version: project.version,
          role: project.role,
        });
        useSyncStore.getState().set({ status: "idle", message: null, conflict: null });
      } catch (caught) {
        if (cancelled) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 404) {
          setLoadError("This project does not exist, or you no longer have access to it.");
        } else {
          setLoadError(caught instanceof ApiError ? caught.message : "Could not open this project.");
        }
      }
    })();

    return () => {
      cancelled = true;
      reset();
    };
  }, [projectId, load, reset]);

  /*
   * The document is the single source of truth for the project's theme.
   *
   * Applying it only once on load was the bug behind "changing the theme does
   * nothing": the setting changed, the document changed, and nothing was
   * watching. Deriving it here also covers the cases an imperative call in the
   * settings panel would have missed - undo, redo, and adopting the server's
   * document after a conflict.
   */
  useEffect(() => {
    if (doc) {
      setProjectTheme(doc.settings.theme);
    }
  }, [doc?.settings.theme, doc, setProjectTheme]);

  useSyncEngine(doc !== null && !readOnly);
  useShortcuts(!readOnly);

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas px-4 text-center">
        <h1 className="text-title text-ink">Cannot open this timeline</h1>
        <p className="max-w-sm text-body text-ink-muted">{loadError}</p>
        <Button variant="primary" onClick={() => navigate("/")}>
          Back to projects
        </Button>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3 text-ink-subtle">
          <ChronoplotMark className="size-8 animate-pulse text-accent" />
          <p className="text-caption">Opening timeline…</p>
        </div>
      </div>
    );
  }

  const isEmpty = doc.rows.length === 0 && doc.groups.length === 0;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <Toolbar onShare={() => setSharing(true)} onExport={() => setExporting(true)} readOnly={readOnly} />

      {readOnly ? (
        <div className="shrink-0 border-b border-line bg-warning/10 px-4 py-1.5 text-caption text-ink-muted">
          You have view-only access to this timeline. Changes are not saved.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-sunken px-4 text-center">
            <h2 className="text-heading text-ink">This timeline is empty</h2>
            <p className="max-w-sm text-body text-ink-muted">
              Add a lane, then drag across it to create a card. A single click makes a milestone.
            </p>
            <Button
              variant="primary"
              icon={<PlusIcon />}
              disabled={readOnly}
              onClick={() => commands.addRow()}
            >
              Add the first lane
            </Button>
          </div>
        ) : (
          <TimelineCanvas doc={doc} readOnly={readOnly} />
        )}

        <Inspector doc={doc} readOnly={readOnly} />
      </div>

      {projectId ? (
        <ShareDialog open={sharing} onOpenChange={setSharing} projectId={projectId} />
      ) : null}
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        doc={doc}
        title={useEditorStore.getState().title}
      />
      <ConflictDialog />
    </div>
  );
}
