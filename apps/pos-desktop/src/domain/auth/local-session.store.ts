/**
 * Zustand store for the current POS session.
 *
 * Holds the session in memory for the lifetime of the running app process.
 * It is never persisted to disk — closing and reopening the app always
 * requires a fresh login.
 *
 * This is a deliberate scope boundary: it does not attempt to survive an
 * app restart while offline, and it does not attempt to detect a server-side
 * revocation of the underlying account (deactivation, role change, password
 * reset) while running on a cached session.
 */
import { create } from 'zustand';

/**
 * Shape of the claims carried in a local session.
 *
 * Populated once from the server's POST /auth/login response and held in
 * memory for the lifetime of the app process.
 */
export interface LocalSession {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  workstationId: string;
}

interface LocalSessionState {
  session: LocalSession | null;
  setSession: (session: LocalSession) => void;
  clearSession: () => void;
}

export const useLocalSessionStore = create<LocalSessionState>((set) => ({
  session: null,

  setSession: (session: LocalSession) => set({ session }),

  clearSession: () => set({ session: null }),
}));