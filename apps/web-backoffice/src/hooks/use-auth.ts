import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AuthUser } from "../types/backoffice";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  user: AuthUser | null;
  setSession: (
    accessToken: string,
    refreshToken: string,
    expiresAt: string,
    user: AuthUser,
  ) => void;
  setTokens: (
    accessToken: string,
    refreshToken: string,
    expiresAt: string,
  ) => void;
  setUser: (user: AuthUser) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      setSession: (accessToken, refreshToken, expiresAt, user) =>
        set({ accessToken, refreshToken, expiresAt, user }),
      setTokens: (accessToken, refreshToken, expiresAt) =>
        set({ accessToken, refreshToken, expiresAt }),
      setUser: (user) => set({ user }),
      clearSession: () =>
        set({
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          user: null,
        }),
    }),
    {
      name: "backoffice-auth",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
