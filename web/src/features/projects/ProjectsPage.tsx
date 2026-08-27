import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectSummary } from "@shared";
import { ApiError, api } from "@/lib/api";
import { useSessionStore } from "@/state/session";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Tooltip } from "@/components/ui/Popover";
import { ThemeSwitcher } from "@/features/theme/ThemeSwitcher";
import {
  BarIcon, ChronoplotMark, LogOutIcon, PlusIcon, ShareIcon, TrashIcon,
} from "@/components/icons";

const relativeTime = (timestamp: number): string => {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
};

export function ProjectsPage() {
  const navigate = useNavigate();
  const { user, signOut } = useSessionStore();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);

  const reload = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load your projects.");
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (): Promise<void> => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      const { project } = await api.createProject(title);
      setCreating(false);
      setNewTitle("");
      navigate(`/p/${project.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the project.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.deleteProject(pendingDelete.id);
      setPendingDelete(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete the project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-[var(--rail-height)] shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-sm bg-accent text-accent-ink">
            <ChronoplotMark className="size-4" />
          </span>
          <span className="text-heading text-ink">Chronoplot</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="mr-1 hidden text-caption text-ink-subtle sm:block">{user?.name}</span>
          <ThemeSwitcher />
          <Tooltip content="Sign out">
            <IconButton label="Sign out" onClick={() => void signOut()}>
              <LogOutIcon />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-4 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-display text-ink">Projects</h1>
            <p className="mt-1 text-body text-ink-muted">
              {projects === null
                ? "Loading…"
                : projects.length === 0
                  ? "Nothing here yet."
                  : `${projects.length} timeline${projects.length === 1 ? "" : "s"}.`}
            </p>
          </div>
          <Button variant="primary" size="lg" icon={<PlusIcon />} onClick={() => setCreating(true)}>
            New timeline
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mb-4 rounded-md bg-critical/10 px-3 py-2 text-body text-critical">
            {error}
          </p>
        ) : null}

        {projects !== null && projects.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <BarIcon className="size-6" />
            </span>
            <div>
              <h2 className="text-heading text-ink">Create your first timeline</h2>
              <p className="mt-1 max-w-sm text-body text-ink-muted">
                Set a date range, drag out a few cards, and export a clean PDF when it’s ready.
              </p>
            </div>
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              New timeline
            </Button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(projects ?? []).map((project) => (
              <li key={project.id}>
                <div
                  className={cn(
                    "group relative flex h-full flex-col justify-between gap-4 rounded-lg border border-line",
                    "bg-surface p-4 shadow-1 transition-[border-color,transform,box-shadow]",
                    "duration-[var(--dur-base)] ease-standard",
                    "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-2",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/p/${project.id}`)}
                    className="text-left after:absolute after:inset-0 after:content-['']"
                  >
                    <h3 className="truncate-1 text-heading text-ink">{project.title}</h3>
                    <p className="mt-1 text-caption text-ink-subtle">
                      {project.rowCount} lane{project.rowCount === 1 ? "" : "s"} ·{" "}
                      {project.itemCount} card{project.itemCount === 1 ? "" : "s"}
                    </p>
                  </button>

                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink-subtle">
                      {project.role !== "owner" ? (
                        <>
                          <ShareIcon className="size-3.5 shrink-0" />
                          <span className="truncate-1">
                            {project.ownerName} · {project.role}
                          </span>
                        </>
                      ) : (
                        <span className="truncate-1">Edited {relativeTime(project.updatedAt)}</span>
                      )}
                    </span>

                    {project.role === "owner" ? (
                      <IconButton
                        label={`Delete ${project.title}`}
                        size="sm"
                        // Sits above the card-wide click target.
                        className="relative z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDelete(project);
                        }}
                      >
                        <TrashIcon />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New timeline"
        description="You can change the date range and everything else once it’s open."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void create()}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Title">
          {(props) => (
            <Input
              {...props}
              autoFocus
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
              placeholder="Product roadmap 2026"
            />
          )}
        </Field>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this timeline?"
        description={`“${pendingDelete?.title ?? ""}” and everything on it will be removed. This cannot be undone.`}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Keep it</Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-body text-ink-muted">
          Anyone you shared it with will lose access as well.
        </p>
      </Dialog>
    </div>
  );
}
