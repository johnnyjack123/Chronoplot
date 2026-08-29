import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type AdminUser } from "@/lib/api";
import { useSessionStore } from "@/state/session";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Segmented, Switch } from "@/components/ui/Controls";
import { Tooltip } from "@/components/ui/Popover";
import { PlusIcon, TrashIcon } from "@/components/icons";

/*
 * Instance administration.
 *
 * The server is the authority on every rule enforced here - who may act, and
 * that the last administrator cannot be removed. This screen only makes those
 * rules visible; disabling a button is a courtesy, never the check.
 */
export function AdminDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useSessionStore((state) => state.user);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", password: "", role: "user" as "admin" | "user" });
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);

  const reload = useCallback(async () => {
    try {
      const [userList, settings] = await Promise.all([api.adminUsers(), api.adminSettings()]);
      setUsers(userList.users);
      setAllowRegistration(settings.allowRegistration);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load the admin data.");
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const guard = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const adminCount = users.filter((user) => user.role === "admin").length;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title="Administration"
        description="Who can sign in to this instance, and who can administer it."
        footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
      >
        <div className="flex flex-col gap-5">
          {error ? (
            <p role="alert" className="rounded-md bg-critical/10 px-3 py-2 text-body text-critical">
              {error}
            </p>
          ) : null}

          <section className="rounded-md border border-line bg-sunken p-3">
            <Switch
              checked={allowRegistration}
              onChange={(next) => void guard(() => api.setAdminSettings(next))}
              label="Anyone can create an account"
              hint={
                allowRegistration
                  ? "The sign-in page offers registration."
                  : "Only accounts created here can sign in."
              }
            />
            <p className="mt-2 text-caption text-ink-subtle">
              Stored on the server, so it survives a restart. The{" "}
              <code className="text-ink-muted">ALLOW_REGISTRATION</code> environment variable only
              sets the value this instance starts with.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-micro uppercase text-ink-subtle">
                Accounts ({users.length})
              </h3>
              <Button size="sm" icon={<PlusIcon />} onClick={() => setCreating(true)}>
                New account
              </Button>
            </div>

            <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
              {users.map((user) => {
                const isSelf = user.id === me?.id;
                const lastAdmin = user.role === "admin" && adminCount === 1;
                return (
                  <li key={user.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-label",
                        user.role === "admin"
                          ? "bg-accent text-accent-ink"
                          : "bg-accent-soft text-accent",
                      )}
                    >
                      {user.name.slice(0, 1).toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate-1 text-body text-ink">
                        {user.name}
                        {isSelf ? <span className="text-ink-subtle"> (you)</span> : null}
                      </span>
                      <span className="block truncate-1 text-caption text-ink-subtle">
                        {user.email} · {user.projectCount} project
                        {user.projectCount === 1 ? "" : "s"}
                      </span>
                    </span>

                    <Segmented<"admin" | "user">
                      size="sm"
                      value={user.role}
                      onChange={(role) => void guard(() => api.adminSetRole(user.id, role))}
                      options={[
                        { value: "user", label: "User" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />

                    <Button size="sm" onClick={() => { setResetting(user); setResetPassword(""); }}>
                      Reset password
                    </Button>

                    <Tooltip
                      content={
                        isSelf
                          ? "You cannot delete your own account"
                          : lastAdmin
                            ? "The only administrator cannot be deleted"
                            : `Delete ${user.name} and their projects`
                      }
                    >
                      <IconButton
                        label={`Delete ${user.name}`}
                        size="sm"
                        disabled={isSelf || lastAdmin}
                        onClick={() => setPendingDelete(user)}
                      >
                        <TrashIcon />
                      </IconButton>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </Dialog>

      {/* ------------------------------------------------------ new account -- */}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New account"
        description="The person can change their name and password once they sign in."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!draft.name.trim() || !draft.email.trim() || draft.password.length < 10}
              onClick={() =>
                void guard(async () => {
                  await api.adminCreateUser({
                    name: draft.name.trim(),
                    email: draft.email.trim(),
                    password: draft.password,
                    role: draft.role,
                  });
                  setCreating(false);
                  setDraft({ name: "", email: "", password: "", role: "user" });
                })
              }
            >
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            )}
          </Field>
          <Field label="Email">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              />
            )}
          </Field>
          <Field label="Initial password" hint="At least 10 characters. Share it out of band.">
            {(props) => (
              <Input
                {...props}
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
            )}
          </Field>
          <Field label="Role">
            {() => (
              <Segmented<"admin" | "user">
                value={draft.role}
                onChange={(role) => setDraft({ ...draft, role })}
                options={[
                  { value: "user", label: "User" },
                  { value: "admin", label: "Administrator" },
                ]}
              />
            )}
          </Field>
        </div>
      </Dialog>

      {/* --------------------------------------------------- reset password -- */}
      <Dialog
        open={resetting !== null}
        onOpenChange={(next) => !next && setResetting(null)}
        title={`Reset password for ${resetting?.name ?? ""}`}
        description="They will be signed out everywhere and will need the new password."
        footer={
          <>
            <Button onClick={() => setResetting(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={resetPassword.length < 10}
              onClick={() =>
                void guard(async () => {
                  if (resetting) await api.adminResetPassword(resetting.id, resetPassword);
                  setResetting(null);
                  setResetPassword("");
                })
              }
            >
              Reset
            </Button>
          </>
        }
      >
        <Field label="New password" hint="At least 10 characters.">
          {(props) => (
            <Input
              {...props}
              autoFocus
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
            />
          )}
        </Field>
      </Dialog>

      {/* --------------------------------------------------- delete account -- */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? ""}?`}
        description="This removes the account and every project it owns. It cannot be undone."
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Keep it</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void guard(async () => {
                  if (pendingDelete) await api.adminDeleteUser(pendingDelete.id);
                  setPendingDelete(null);
                })
              }
            >
              Delete account
            </Button>
          </>
        }
      >
        <p className="text-body text-ink-muted">
          {pendingDelete?.projectCount ?? 0} project
          {pendingDelete?.projectCount === 1 ? "" : "s"} will be deleted along with the account.
        </p>
      </Dialog>
    </>
  );
}
