import { IdentificationType, RoleType, UserStatus, AuthMethod } from "./enums";

export interface User {
  id: string;
  subscriptionId: string | null;
  role: RoleType;
  email: string | null;
  username: string | null;
  displayName: string;
  firstName?: string;
  lastName?: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  authMethod: AuthMethod;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  passwordHash?: string;
  passwordAlgorithm?: string;
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
