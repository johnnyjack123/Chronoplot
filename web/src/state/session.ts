import { create } from "zustand";
import { api, ApiError, type SessionUser } from "@/lib/api";

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
      if (!(error instanceof ApiError)) throw error;
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
