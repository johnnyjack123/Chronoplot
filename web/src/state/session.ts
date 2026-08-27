import { create } from "zustand";
import { api, ApiError, type SessionUser } from "@/lib/api";

interface SessionState {
  user: SessionUser | null;
  allowRegistration: boolean;
  /** Undefined until the first /api/auth/me call resolves. */
  ready: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: SessionUser) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  allowRegistration: true,
  ready: false,

  refresh: async () => {
    try {
      const { user, allowRegistration } = await api.session();
      set({ user, allowRegistration, ready: true });
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

  setUser: (user) => set({ user, ready: true }),
}));
