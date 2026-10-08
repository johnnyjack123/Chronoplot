import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { TooltipProvider } from "./components/ui/Popover";
import { useSessionStore } from "./state/session";
import { applyTheme, useThemeStore } from "./state/theme";
import { AuthPage } from "./features/auth/AuthPage";
import { SetupPage } from "./features/auth/SetupPage";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import { EditorPage } from "./features/editor/EditorPage";
import { ChronoplotMark } from "./components/icons";

/** Shown while the initial session check is in flight. */
function BootScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3 text-ink-subtle">
        <ChronoplotMark className="size-8 animate-pulse text-accent" />
        <p className="text-caption">Loading Chronoplot…</p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready, needsSetup } = useSessionStore();
  const location = useLocation();

  if (!ready) {
    return <BootScreen />;
  }
  // An empty instance has nowhere to sign in to, so send people to set it up
  // rather than to a form none of their credentials can satisfy.
  if (!user && needsSetup) {
    return <Navigate to="/setup" replace />;
  }
  if (!user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * The mirror of RequireAuth, for the two pages that exist to get you a session.
 *
 * Reaching a sign-in form while already signed in is the same confusion as the
 * dashboard while signed out, just pointing the other way - and it is exactly
 * what the browser's back button does after a login.
 */
function RedirectIfAuthed({ children, page }: { children: React.ReactNode; page: "signin" | "setup" }) {
  const { user, ready, needsSetup } = useSessionStore();

  if (!ready) {
    return <BootScreen />;
  }
  if (user) {
    return <Navigate to="/" replace />;
  }
  // Setup is for an instance with no accounts. Once one exists, the way in is
  // the sign-in form - offering to "create the administrator" again would be a
  // promise the server refuses to keep.
  if (page === "setup" && !needsSetup) {
    return <Navigate to="/signin" replace />;
  }
  if (page === "signin" && needsSetup) {
    return <Navigate to="/setup" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const refresh = useSessionStore((state) => state.refresh);
  const activeTheme = useThemeStore((state) => state.active);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // One place applies the theme, derived from state rather than set by whoever
  // last changed it.
  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  return (
    <BrowserRouter>
      <TooltipProvider>
        <Routes>
          <Route
            path="/setup"
            element={
              <RedirectIfAuthed page="setup">
                <SetupPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/signin"
            element={
              <RedirectIfAuthed page="signin">
                <AuthPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <ProjectsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/p/:projectId"
            element={
              <RequireAuth>
                <EditorPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TooltipProvider>
    </BrowserRouter>
  );
}
