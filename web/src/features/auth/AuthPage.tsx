import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "@/lib/api";
import { useSessionStore } from "@/state/session";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ChronoplotMark } from "@/components/icons";
import { ThemeSwitcher } from "@/features/theme/ThemeSwitcher";

type Mode = "signin" | "register";

export function AuthPage() {
  const { user, ready, allowRegistration, setUser } = useSessionStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ready && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/signin" ? from : "/"} replace />;
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === "signin"
          ? await api.login(email, password)
          : await api.register(name, email, password);
      setUser(result.user);
      navigate("/", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-canvas px-4">
      {/*
        A single, very soft accent wash behind the card. It is the one piece of
        pure decoration in the product, and it stays under 10% alpha so it reads
        as depth rather than as a gradient background.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
      />

      <div className="absolute right-4 top-4">
        <ThemeSwitcher />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-md bg-accent text-accent-ink shadow-1">
            <ChronoplotMark className="size-6" />
          </div>
          <div>
            <h1 className="text-title text-ink">Chronoplot</h1>
            <p className="mt-1 text-body text-ink-muted">
              Build beautiful, printable timelines.
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-2"
        >
          {mode === "register" ? (
            <Field label="Name">
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  placeholder="Your name"
                />
              )}
            </Field>
          ) : null}

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
            hint={mode === "register" ? "At least 10 characters." : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                minLength={mode === "register" ? 10 : undefined}
                placeholder="••••••••••"
              />
            )}
          </Field>

          {error ? (
            <p role="alert" className="rounded-sm bg-critical/10 px-3 py-2 text-caption text-critical">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>

          {allowRegistration ? (
            <p className="text-center text-caption text-ink-subtle">
              {mode === "signin" ? "No account yet?" : "Already registered?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "signin" ? "register" : "signin");
                  setError(null);
                }}
                className="text-accent underline-offset-2 hover:underline"
              >
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </p>
          ) : mode === "signin" ? (
            <p className="text-center text-caption text-ink-subtle">
              Registration is closed on this server.
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
