import { useEffect, useState } from "react";
import type { ProjectSummary } from "@shared";
import { ApiError, api, type ApiTokenSummary } from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Controls";
import { CopyIcon, TrashIcon } from "@/components/icons";

const EXPIRY_OPTIONS = [
  { value: "0", label: "Never expires" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "A year" },
] as const;

const when = (at: number | null): string =>
  at === null ? "never" : new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" });

/**
 * API tokens, which is how the Obsidian plugin gets in.
 *
 * The one rule that shapes this whole panel: the secret exists in readable form
 * for exactly one response. There is no "show token" button to build, because
 * only its SHA-256 is stored - so the value has to be presented at creation
 * time, insistently enough that nobody closes the dialog expecting to find it
 * again later.
 *
 * @returns The panel shown on the account dialog's "API tokens" tab.
 */
export function TokenPanel() {
  const [tokens, setTokens] = useState<ApiTokenSummary[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("Obsidian");
  const [scope, setScope] = useState("");
  const [expiry, setExpiry] = useState<string>("0");
  const [busy, setBusy] = useState(false);

  /** The freshly minted secret, held only in this component's state. */
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const [tokenList, projectList] = await Promise.all([api.listTokens(), api.listProjects()]);
      setTokens(tokenList.tokens);
      setProjects(projectList.projects);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load your tokens.");
      setTokens([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.createToken(
        trimmed,
        scope === "" ? null : scope,
        expiry === "0" ? null : Number(expiry),
      );
      setFresh(result.token);
      setCopied(false);
      setName("Obsidian");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create a token.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiTokenSummary): Promise<void> => {
    setError(null);
    try {
      await api.revokeToken(token.id);
      // A revoked token may well be the one on screen; it is worthless now.
      setFresh(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not revoke that token.");
    }
  };

  const copy = async (): Promise<void> => {
    if (!fresh) {
      return;
    }
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright. The value is selectable on
      // screen, so there is still a way through - saying so beats a dead end.
      setError("Could not reach the clipboard. Select the token and copy it by hand.");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-caption text-ink-subtle">
        A token lets a program act as you without your password — the Obsidian plugin uses one to
        push dated notes into a project. Scope it to a single project unless you have a reason not
        to.
      </p>

      {fresh ? (
        <div className="flex flex-col gap-2 rounded-md border border-accent bg-raised p-3">
          <h4 className="text-label text-ink">Your new token</h4>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-[4px] bg-sunken px-2 py-1.5 text-caption text-ink">
              {fresh}
            </code>
            <IconButton
              label={copied ? "Copied" : "Copy the token"}
              onClick={() => void copy()}
            >
              <CopyIcon />
            </IconButton>
          </div>
          <p className="text-caption text-warning">
            Copy it now. Only a hash is stored, so this is the last time it can be shown — if you
            lose it, revoke it and make another.
          </p>
          {copied ? <p className="text-caption text-good">Copied to the clipboard.</p> : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-micro uppercase text-ink-subtle">New token</h3>

        <Field label="What is it for?" hint="Shown in the list below, so you can tell them apart.">
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void create();
                }
              }}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Can reach">
            {(props) => (
              <Select
                {...props}
                value={scope}
                onChange={setScope}
                options={[
                  { value: "", label: "Every project you can" },
                  ...projects.map((project) => ({ value: project.id, label: project.title })),
                ]}
              />
            )}
          </Field>
          <Field label="Expires">
            {(props) => (
              <Select
                {...props}
                value={expiry}
                onChange={setExpiry}
                options={EXPIRY_OPTIONS.map((option) => ({ ...option }))}
              />
            )}
          </Field>
        </div>

        <div>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void create()}>
            Create token
          </Button>
        </div>
        {error ? <p className="text-caption text-critical">{error}</p> : null}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-5">
        <h3 className="text-micro uppercase text-ink-subtle">
          Your tokens{tokens ? ` (${tokens.length})` : ""}
        </h3>

        {tokens === null ? (
          <p className="text-caption text-ink-subtle">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-caption text-ink-subtle">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {tokens.map((token) => {
              const expired = token.expiresAt !== null && token.expiresAt < Date.now();
              return (
                <li
                  key={token.id}
                  className="flex items-center gap-3 rounded-md border border-line px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate-1 text-label text-ink">
                      {token.name}
                      {expired ? <span className="ml-2 text-caption text-critical">expired</span> : null}
                    </p>
                    <p className="truncate-1 text-caption text-ink-subtle">
                      {token.projectTitle ?? "Every project"} · last used {when(token.lastUsedAt)} ·
                      expires {when(token.expiresAt)}
                    </p>
                  </div>
                  <IconButton label={`Revoke ${token.name}`} onClick={() => void revoke(token)}>
                    <TrashIcon />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-caption text-ink-subtle">
          Revoking takes effect at once. Anything still using that token stops syncing.
        </p>
      </section>
    </div>
  );
}
