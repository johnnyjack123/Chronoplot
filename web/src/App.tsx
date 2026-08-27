import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { TooltipProvider } from "./components/ui/Popover";
import { useSessionStore } from "./state/session";
import { AuthPage } from "./features/auth/AuthPage";
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
  const { user, ready } = useSessionStore();
  const location = useLocation();

  if (!ready) return <BootScreen />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  const refresh = useSessionStore((state) => state.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BrowserRouter>
      <TooltipProvider>
        <Routes>
          <Route path="/signin" element={<AuthPage />} />
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
