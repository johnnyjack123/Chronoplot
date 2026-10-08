import { create } from "zustand";
import { api, ApiError, setUnauthenticatedHandler, type SessionUser } from "@/lib/api";

interface SessionState {
  user: SessionUser | null;
  allowRegistration: boolean;
  /** True while the instance has no accounts at all. */
  needsSetup: boolean;
  /** Undefined until the first /api/auth/me call resolves. */
  ready: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: SessionUser) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  allowRegistration: true,
  needsSetup: false,
  ready: false,

  refresh: async () => {
    try {
      const { user, allowRegistration, needsSetup } = await api.session();
      set({ user, allowRegistration, needsSetup, ready: true });
    } catch (error) {
      // A server that cannot be reached is not the same as being signed out,
      // but from the app's point of view both mean "show the sign-in screen".
      if (!(error instanceof ApiError)) {
        throw error;
      }
      set({ user: null, ready: true });
    }
  },

  signOut: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null });
    }
  },

  // Signing in or completing setup means the instance is no longer empty.
  setUser: (user) => set({ user, needsSetup: false, ready: true }),
}));

/*
 * Any 401 from anywhere means the session is gone, whatever this tab believes.
 * Dropping the user is enough to act on it: the route guard in App.tsx derives
 * the redirect from exactly this, so there is one rule about who may see a
 * page rather than a second one here that could disagree with it.
 */
setUnauthenticatedHandler(() => {
  useSessionStore.setState({ user: null, ready: true });
});
