import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useSessionStore } from "@/state/session";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Controls";
import { TrashIcon } from "@/components/icons";

type Role = "owner" | "editor" | "viewer";
interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function ShareDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const currentUser = useSessionStore((state) => state.user);
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const result = await api.listMembers(projectId);
      setMembers(result.members);
      setCanManage(result.canManage);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load the member list.");
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const invite = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.addMember(projectId, trimmed, role);
      setEmail("");
      await reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not share the project.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string): Promise<void> => {
    setBusy(true);
    try {
      await api.removeMember(projectId, userId);
      await reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not remove that person.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share this timeline"
      description="People need an account on this server before they can be added."
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      <div className="flex flex-col gap-4">
        {canManage ? (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-sunken p-3">
            <Field label="Email address">
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void invite();
                  }}
                  placeholder="colleague@example.com"
                />
              )}
            </Field>

            <Field label="Access">
              {() => (
                <Segmented<"editor" | "viewer">
                  value={role}
                  onChange={setRole}
                  options={[
                    { value: "editor", label: "Can edit" },
                    { value: "viewer", label: "Can view" },
                  ]}
                />
              )}
            </Field>

            <Button variant="primary" loading={busy} onClick={() => void invite()}>
              Share
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-sm bg-critical/10 px-3 py-2 text-caption text-critical">
            {error}
          </p>
        ) : null}

        <ul className="flex flex-col gap-1">
          {members.map((member) => {
            const isSelf = member.id === currentUser?.id;
            const removable = member.role !== "owner" && (canManage || isSelf);
            return (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent-soft/50"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-label text-accent">
                  {member.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate-1 text-body text-ink">
                    {member.name}
                    {isSelf ? <span className="text-ink-subtle"> (you)</span> : null}
                  </span>
                  <span className="block truncate-1 text-caption text-ink-subtle">{member.email}</span>
                </span>
                <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-micro uppercase text-ink-muted">
                  {member.role}
                </span>
                {removable ? (
                  <IconButton
                    label={isSelf ? "Leave this project" : `Remove ${member.name}`}
                    size="sm"
                    onClick={() => void remove(member.id)}
                  >
                    <TrashIcon />
                  </IconButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
