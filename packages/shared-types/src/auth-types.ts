import { RoleType, UserStatus, AuthMethod, SessionStatus, StepUpStatus, StepUpMethod } from './enums';

export interface UserSession {
  id: string;
  userId: string;
  workstationId: string;
  workstationFingerprint: string | null;
  deviceInfo: string | null;
  ipAddress: string | null;
  geoCountry: string | null;
  geoCity: string | null;
  accessTokenId: string | null;
  refreshTokenId: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  lastActiveAt: Date;
  status: SessionStatus;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokedReason: string | null;
  createdAt: Date;
}

export interface StepUpRequest {
  id: string;
  operationType: string;
  operationId: string | null;
  requestingUserId: string;
  workstationId: string;
  requiredRole: RoleType;
  status: StepUpStatus;
  method: StepUpMethod;
  approvedByUserId: string | null;
  deniedByUserId: string | null;
  denialReason: string | null;
  approvalToken: string | null;
  oneTimeCode: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface AuditLogEntry {
  id: string;
  event: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  workstationId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface UserLocationAccess {
  id: string;
  userId: string;
  locationId: string;
  locationName?: string;
  createdAt: Date;
}

export interface LoginAttempt {
  id: string;
  userId: string | null;
  identifier: string;
  sessionType: string;
  workstationId: string | null;
  ipAddress: string | null;
  success: boolean;
  failureReason: string | null;
  createdAt: Date;
}

/** Expanded user type for the new identity system */
export interface DetailedUser {
  id: string;
  subscriptionId: string | null;
  role: RoleType;
  email: string | null;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  authMethod: AuthMethod;
  totpEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  lastPasswordChangeAt: Date | null;
  status: UserStatus;
  mustChangePassword: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
