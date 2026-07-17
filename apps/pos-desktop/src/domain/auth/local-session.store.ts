/**
 * Zustand store for the current POS session.
 *
 * Holds the session in memory for the lifetime of the running app process.
 * Supports refresh token rotation and role-based access.
 *
 * On startup, the service checks for a stored session. If present and the
 * access token is valid, the user is auto-logged in. If expired, the refresh
 * token is used silently. If refresh fails, the user is sent to the login page.
 *
 * A background refresh timer keeps the session alive while the user is active.
 */
import { create } from 'zustand';
import { RoleType } from '@pharmacy/shared-types';

/**
 * Shape of the claims carried in a local session.
 */
export interface LocalSession {
  userId: string;
  username: string;
  fullName: string;
  displayName: string;
  email: string | null;
  role: RoleType | string;
  subscriptionId: string | null;
  workstationId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  sessionId: string;
  totpEnabled: boolean;
  avatarUrl: string | null;
  avatarColor: string | null;
  mustChangePassword: boolean;
  locationIds?: string[];
  /** Long-lived offline JWT for credential recovery when the access token expires. */
  offlineToken?: string;
}

interface LocalSessionState {
  session: LocalSession | null;
  isInitialized: boolean;
  setSession: (session: LocalSession) => void;
  updateSession: (partial: Partial<LocalSession>) => void;
  clearSession: () => void;
  setInitialized: (val: boolean) => void;
}

export const useLocalSessionStore = create<LocalSessionState>((set) => ({
  session: null,
  isInitialized: false,

  setSession: (session: LocalSession) => set({ session, isInitialized: true }),

  updateSession: (partial: Partial<LocalSession>) =>
    set((state) => ({
      session: state.session ? { ...state.session, ...partial } : null,
    })),

  clearSession: () => set({ session: null }),

  setInitialized: (val: boolean) => set({ isInitialized: val }),
}));

/**
 * Check if the current user has at least the given role level.
 * Hierarchy: SAAS_ADMIN > OWNER > MANAGER > CASHIER
 */
export function hasMinRole(
  session: LocalSession | null,
  minRole: RoleType,
): boolean {
  if (!session) return false;

  const hierarchy: Record<string, number> = {
    CASHIER: 0,
    INVENTORY_ASSISTANT: 0,
    MANAGER: 1,
    ACCOUNTANT: 1,
    OWNER: 2,
    ADMIN: 2,
    SAAS_ADMIN: 3,
  };

  const userLevel = hierarchy[session.role] ?? -1;
  const requiredLevel = hierarchy[minRole] ?? -1;

  return userLevel >= requiredLevel;
}
