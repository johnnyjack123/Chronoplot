import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useSessionStore } from "@/state/session";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Controls";
import { TokenPanel } from "./TokenPanel";

type Tab = "profile" | "tokens";

/**
 * The account's own settings: display name, password, and API tokens.
 *
 * Kept separate from the admin screen on purpose - changing your own name is
 * something every account can do, and folding it into an administrator-only
 * page would hide it from most people who need it. Tokens live here for the
 * same reason: they act as you, so they are yours to manage, not an
 * administrator's.
 */
export function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, setUser } = useSessionStore();

  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [nameState, setNameState] = useState<{ error?: string; done?: boolean; busy?: boolean }>({});
  const [passwordState, setPasswordState] = useState<{ error?: string; done?: boolean; busy?: boolean }>({});
  const [tab, setTab] = useState<Tab>("profile");

  useEffect(() => {
    if (!open) {
      return;
    }
    setTab("profile");
    setName(user?.name ?? "");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setNameState({});
    setPasswordState({});
  }, [open, user?.name]);

  const saveName = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.name) {
      return;
    }
    setNameState({ busy: true });
    try {
      const result = await api.updateProfile(trimmed);
      setUser(result.user);
      setNameState({ done: true });
    } catch (caught) {
      setNameState({ error: caught instanceof ApiError ? caught.message : "Could not save that." });
    }
  };

  const savePassword = async (): Promise<void> => {
    if (newPassword !== confirmPassword) {
      setPasswordState({ error: "The two new passwords do not match." });
      return;
    }
    setPasswordState({ busy: true });
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordState({ done: true });
    } catch (caught) {
      setPasswordState({
        error: caught instanceof ApiError ? caught.message : "Could not change the password.",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Your account"
      description={user?.email}
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      <div className="flex flex-col gap-6">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "profile", label: "Profile" },
            { value: "tokens", label: "API tokens" },
          ]}
        />

        {/* The inactive tab unmounts. That matters for the token panel: a
            freshly created secret must not still be sitting there on the way
            back, and an in-flight name edit is cheap to lose by comparison. */}
        {tab === "tokens" ? <TokenPanel /> : null}

        <section className="flex flex-col gap-3" hidden={tab !== "profile"}>
          <h3 className="text-micro uppercase text-ink-subtle">Display name</h3>
          <Field label="Name" hideLabel error={nameState.error ?? null}>
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameState({});
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void saveName();
                  }
                }}
              />
            )}
          </Field>
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              loading={nameState.busy}
              disabled={!name.trim() || name.trim() === user?.name}
              onClick={() => void saveName()}
            >
              Save name
            </Button>
            {nameState.done ? <span className="text-caption text-good">Saved.</span> : null}
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-line pt-5" hidden={tab !== "profile"}>
          <h3 className="text-micro uppercase text-ink-subtle">Password</h3>

          <Field label="Current password">
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  setPasswordState({});
                }}
              />
            )}
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  setPasswordState({});
                }}
              />
            )}
          </Field>
          <Field label="Repeat new password" error={passwordState.error ?? null}>
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setPasswordState({});
                }}
              />
            )}
          </Field>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              loading={passwordState.busy}
              disabled={currentPassword.length < 1 || newPassword.length < 10}
              onClick={() => void savePassword()}
            >
              Change password
            </Button>
            {passwordState.done ? (
              <span className="text-caption text-good">Changed. Other sessions signed out.</span>
            ) : null}
          </div>
          <p className="text-caption text-ink-subtle">
            Changing your password signs out every other browser you are signed in on.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
