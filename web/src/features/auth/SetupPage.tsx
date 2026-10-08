import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, api } from "@/lib/api";
import { useSessionStore } from "@/state/session";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ChronoplotMark, ShieldIcon } from "@/components/icons";
import { ThemeSwitcher } from "@/features/theme/ThemeSwitcher";

/*
 * First run.
 *
 * A brand-new instance has nobody to sign in as, so asking for a password is
 * the wrong question - it looks like the deployment failed rather than like
 * there is a step left to do. This page asks the right one, and says plainly
 * what the account being created is for.
 */
export function SetupPage() {
  const { user, ready, needsSetup, setUser } = useSessionStore();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);

  if (ready && user) {
    return <Navigate to="/" replace />;
  }
  // Somebody set it up already - possibly in another tab, possibly someone
  // else. Either way this page no longer has a job.
  if (ready && !needsSetup && !taken) {
    return <Navigate to="/signin" replace />;
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.register(name, email, password);
      setUser(result.user);
      navigate("/", { replace: true });
    } catch (caught) {
      /*
       * The one race worth handling: somebody claimed the instance between this
       * page loading and the form being submitted. With registration closed -
       * the Docker default - that surfaces as a flat 403, which would be
       * baffling on a page headed "create the administrator".
       */
      if (caught instanceof ApiError && caught.code === "registration_closed") {
        setTaken(true);
        setError("Somebody else has already set this instance up. Sign in instead.");
      } else {
        setError(
          caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-canvas px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
      />

      <div className="absolute right-4 top-4">
        <ThemeSwitcher />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-md bg-accent text-accent-ink shadow-1">
            <ChronoplotMark className="size-6" />
          </div>
          <div>
            <h1 className="text-title text-ink">Set up Chronoplot</h1>
            <p className="mt-1 text-body text-ink-muted">
              This instance is empty. The account you create now administers it.
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-2"
        >
          <div className="flex gap-3 rounded-md border border-line bg-sunken p-3">
            <ShieldIcon className="mt-0.5 size-4 shrink-0 text-accent" />
            <div className="text-caption text-ink-muted">
              <p className="text-label text-ink">You will be the administrator</p>
              <p className="mt-1">
                Administrators create and remove accounts, reset passwords, and decide whether
                anyone else may register. Registration starts closed, so nobody else can sign up
                until you allow it.
              </p>
            </div>
          </div>

          <Field label="Your name">
            {(props) => (
              <Input
                {...props}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                placeholder="Your name"
              />
            )}
          </Field>

          <Field label="Email">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            )}
          </Field>

          <Field
            label="Password"
            hint="At least 10 characters. There is no password reset by email — keep it somewhere safe."
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                minLength={10}
                placeholder="••••••••••"
              />
            )}
          </Field>

          {error ? (
            <p role="alert" className="rounded-sm bg-critical/10 px-3 py-2 text-caption text-critical">
              {error}
            </p>
          ) : null}

          {taken ? (
            <Button variant="primary" size="lg" onClick={() => navigate("/signin", { replace: true })}>
              Go to sign in
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
              Create the administrator account
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
