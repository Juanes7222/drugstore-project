import { IdentificationType, RoleType, UserStatus, AuthMethod } from "./enums";

export interface User {
  id: string;
  subscriptionId: string | null;
  role: RoleType;
  /** Platform-level admin flag for the SaaS owner; never settable via API. */
  isPlatformAdmin: boolean;
  email: string | null;
  username: string | null;
  displayName: string;
  firstName?: string;
  lastName?: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  authMethod: AuthMethod;
  /** Presence-only credential flags; the hash material itself never leaves the server. */
  hasPin?: boolean;
  hasPassword?: boolean;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  lastLoginWorkstationId: string | null;
  lastPasswordChangeAt: Date | null;
  status: UserStatus;
  mustChangePassword: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
