import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { EnvConfig } from '@/config/env.schema';
import {
  RoleType,
  SessionRevocationReason,
  UserStatus,
} from '@pharmacy/database';
import type { User as PrismaUser } from '@pharmacy/database';
import { User } from '@pharmacy/shared-types';
import * as crypto from 'node:crypto';
import { PasswordHasherService } from './services/password-hasher.service';
import { PinService } from './services/pin.service';
import { TotpService } from './services/totp.service';
import { BackupCodesService } from './services/backup-codes.service';
import { SessionService } from './services/session.service';
import { AuditService, AuditEvent } from './services/audit.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';
import { AccountLockedException } from './exceptions/account-locked.exception';
import { AccountInactiveException } from './exceptions/account-inactive.exception';
import { SessionExpiredException } from './exceptions/session-expired.exception';
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  ACCOUNT_LOCK_DURATION_MINUTES,
} from './constants/auth.constants';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface AuthResponseData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  user: User;
  sessionId?: string;
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  evictedSessionId?: string;
}

interface CreateSessionParams {
  identifier: string;
  workstationId: string;
  ipAddress?: string;
  userAgent?: string;
  hardwareFingerprint?: string;
  deviceInfo?: string;
}

interface TwoFactorChallenge {
  userId: string;
  identifier: string;
  workstationId: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

interface PasswordResetEntry {
  userId: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Short-lived 2FA challenges (TTL: 5 min). */
  private readonly twoFactorChallenges = new Map<string, TwoFactorChallenge>();

  /** In-memory password-reset store — replace with DB-backed in production. */
  private readonly passwordResetTokens = new Map<string, PasswordResetEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig>,
    private readonly passwordHasher: PasswordHasherService,
    private readonly pinService: PinService,
    private readonly totpService: TotpService,
    private readonly backupCodesService: BackupCodesService,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Credential validation
  // ---------------------------------------------------------------------------

  /**
   * Validate credentials for login.
   * Returns the full Prisma user (internal — do not leak to API responses directly).
   */
  async validateCredentials(
    identifier: string,
    secret: string,
    sessionType: 'PASSWORD' | 'PIN' = 'PASSWORD',
  ): Promise<PrismaUser> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
        ],
      },
    });

    this.assertAccountIsUsable(user);

    let isValid = false;

    if (sessionType === 'PIN') {
      if (!user.pinHash) {
        throw new InvalidCredentialsException();
      }
      isValid = await this.pinService.verify(user.pinHash, secret);
    } else {
      if (!user.passwordHash) {
        throw new InvalidCredentialsException();
      }
      isValid = await this.passwordHasher.verify(user.passwordHash, secret);
    }

    if (!isValid) {
      await this.handleFailedLoginAttempt(user.id, identifier, sessionType);
      throw new InvalidCredentialsException();
    }

    await this.resetFailedLoginAttempts(user.id);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return user;
  }

  // ---------------------------------------------------------------------------
  // Login flow
  // ---------------------------------------------------------------------------

  /**
   * Initiate a login flow.
   * If TOTP is enabled, returns a challenge token instead of a session.
   */
  async login(params: {
    identifier: string;
    secret: string;
    sessionType: 'PASSWORD' | 'PIN';
    workstationId: string;
    hardwareFingerprint?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: string;
  }): Promise<AuthResponseData> {
    const user = await this.validateCredentials(
      params.identifier,
      params.secret,
      params.sessionType,
    );

    if (user.totpEnabled && params.sessionType === 'PASSWORD') {
      const challengeToken = crypto.randomUUID();
      this.twoFactorChallenges.set(challengeToken, {
        userId: user.id,
        identifier: params.identifier,
        workstationId: params.workstationId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        createdAt: new Date(),
      });

      // Auto-clean after 5 minutes
      setTimeout(() => this.twoFactorChallenges.delete(challengeToken), 5 * 60 * 1000);

      await this.auditService.log(AuditEvent.LOGIN_SUCCESS, {
        actorId: user.id,
        actorRole: user.role,
        workstationId: params.workstationId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: { requiresTwoFactor: true },
      });

      return {
        accessToken: '',
        refreshToken: '',
        expiresAt: new Date(),
        user: this.toSafeUser(user),
        requiresTwoFactor: true,
        challengeToken,
      };
    }

    return this.issueSessionInternal(user, params);
  }

  /**
   * Complete the 2FA step of a login flow.
   */
  async completeTwoFactorLogin(params: {
    challengeToken: string;
    totpCode?: string;
    backupCode?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthResponseData> {
    const challenge = this.twoFactorChallenges.get(params.challengeToken);
    if (!challenge) {
      throw new InvalidCredentialsException('Invalid or expired 2FA challenge');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
    });
    if (!user || !user.isActive) {
      throw new AccountInactiveException();
    }

    let verified = false;

    if (params.totpCode) {
      if (!user.totpSecretEncrypted) {
        throw new InvalidCredentialsException('TOTP not configured');
      }
      verified = this.totpService.verify(user.totpSecretEncrypted, params.totpCode);
    } else if (params.backupCode) {
      if (!user.backupCodesHash) {
        throw new InvalidCredentialsException('Backup codes not available');
      }
      const hashes: string[] = JSON.parse(user.backupCodesHash);
      const index = this.backupCodesService.verify(params.backupCode, hashes);
      if (index >= 0) {
        const updatedHashes = this.backupCodesService.consume(hashes, index);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { backupCodesHash: JSON.stringify(updatedHashes) },
        });
        verified = true;

        await this.auditService.log(AuditEvent.BACKUP_CODE_USED, {
          actorId: user.id,
          actorRole: user.role,
          details: { remainingCodes: updatedHashes.length },
        });
      }
    }

    if (!verified) {
      await this.handleFailedLoginAttempt(
        user.id,
        challenge.identifier,
        'PASSWORD',
      );
      throw new InvalidCredentialsException('Invalid 2FA code');
    }

    this.twoFactorChallenges.delete(params.challengeToken);

    return this.issueSessionInternal(user, {
      identifier: challenge.identifier,
      workstationId: challenge.workstationId,
      ipAddress: params.ipAddress ?? challenge.ipAddress,
      userAgent: params.userAgent ?? challenge.userAgent,
    });
  }

  // ---------------------------------------------------------------------------
  // Session validation
  // ---------------------------------------------------------------------------

  /**
   * Validate an active session by token hash.
   * Throws if the session or user is not usable.
   */
  async validateActiveSession(userId: string, tokenHash: string): Promise<User> {
    const session = await this.sessionService.findActiveSessionByTokenHash(
      tokenHash,
    );

    if (!session) {
      throw new SessionExpiredException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new InvalidCredentialsException();
    }

    if (!user.isActive) {
      throw new AccountInactiveException();
    }

    if (user.status !== UserStatus.ACTIVE && user.status !== UserStatus.PENDING_SETUP) {
      throw new AccountInactiveException();
    }

    // Touch lastActivity asynchronously (fire-and-forget)
    this.sessionService.touchLastActivity(session.id).catch(() => {});

    return this.toSafeUser(user);
  }

  // ---------------------------------------------------------------------------
  // Session issuance & refresh
  // ---------------------------------------------------------------------------

  /**
   * Issue a new session for a given user.
   */
  async issueSession(params: {
    userId: string;
    workstationId: string;
    ipAddress?: string;
    userAgent?: string;
    hardwareFingerprint?: string;
    deviceInfo?: string;
  }): Promise<AuthResponseData> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
    });

    if (!user) {
      throw new InvalidCredentialsException();
    }

    return this.issueSessionInternal(user, {
      identifier: user.email ?? user.username ?? '',
      workstationId: params.workstationId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      hardwareFingerprint: params.hardwareFingerprint,
      deviceInfo: params.deviceInfo,
    });
  }

  /**
   * Refresh tokens — rotates both access and refresh token hashes.
   * Detects refresh-token reuse (potential theft) and revokes all sessions.
   */
  async refreshSession(
    refreshTokenHash: string,
  ): Promise<{ accessToken: string; expiresAt: Date; refreshToken: string }> {
    const session = await this.sessionService.findActiveSessionByRefreshTokenHash(
      refreshTokenHash,
    );

    if (!session) {
      // Check if the refresh token was already used (reuse detection)
      const reusedSession = await this.prisma.userSession.findFirst({
        where: { refreshTokenHash },
      });

      if (reusedSession && reusedSession.status === 'REVOKED') {
        // Refresh token reuse — revoke all sessions for this user
        await this.sessionService.revokeUserSessions(
          reusedSession.userId,
          SessionRevocationReason.SECURITY_ANOMALY,
        );
        this.logger.warn(
          `Refresh token reuse detected for user ${reusedSession.userId}. All sessions revoked.`,
        );

        await this.auditService.log(AuditEvent.REVOKED_REFRESH_REUSE, {
          actorId: reusedSession.userId,
          actorRole: null,
          sessionId: reusedSession.id,
          details: { tokenReuse: true },
        });
      }

      throw new SessionExpiredException();
    }

    const accessTokenTtl = this.configService.get('JWT_ACCESS_TTL_SECONDS')!;
    const refreshTokenTtl = this.configService.get('JWT_REFRESH_TTL_SECONDS')!;

    const newTokenHash = this.hashToken(crypto.randomBytes(32).toString('hex'));
    const newRefreshTokenHash = this.hashToken(
      crypto.randomBytes(32).toString('hex'),
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + accessTokenTtl * 1000);

    const accessToken = this.jwtService.sign(
      {
        sub: session.userId,
        tokenHash: newTokenHash,
        jti: crypto.randomUUID(),
        sessionId: session.id,
      },
      { expiresIn: accessTokenTtl },
    );

    const refreshToken = this.jwtService.sign(
      {
        sub: session.userId,
        refreshTokenHash: newRefreshTokenHash,
        jti: crypto.randomUUID(),
        sessionId: session.id,
      },
      { expiresIn: refreshTokenTtl },
    );

    await this.sessionService.updateSessionTokens(
      session.id,
      newTokenHash,
      newRefreshTokenHash,
      expiresAt,
    );

    await this.auditService.log(AuditEvent.REFRESH_TOKEN, {
      actorId: session.userId,
      actorRole: null,
      sessionId: session.id,
    });

    return { accessToken, refreshToken, expiresAt };
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  async logoutSession(tokenHash: string): Promise<void> {
    const session = await this.sessionService.findActiveSessionByTokenHash(
      tokenHash,
    );

    if (!session) {
      return; // Idempotent
    }

    await this.sessionService.revokeSession(session.id, SessionRevocationReason.LOGOUT);

    await this.auditService.log(AuditEvent.LOGOUT, {
      actorId: session.userId,
      actorRole: null,
      sessionId: session.id,
      workstationId: session.workstationId,
    });
  }

  // ---------------------------------------------------------------------------
  // Password & PIN management
  // ---------------------------------------------------------------------------

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw new InvalidCredentialsException();
    }

    const isValid = await this.passwordHasher.verify(
      user.passwordHash,
      currentPassword,
    );
    if (!isValid) {
      throw new InvalidCredentialsException('Current password is incorrect');
    }

    const { hash: newHash, algorithm } = await this.passwordHasher.hash(
      newPassword,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        passwordAlgorithm: algorithm,
        lastPasswordChangeAt: new Date(),
        mustChangePassword: false,
      },
    });

    // Revoke all other sessions except the current one
    await this.sessionService.revokeUserSessions(
      userId,
      SessionRevocationReason.PASSWORD_CHANGED,
    );

    await this.auditService.log(AuditEvent.PASSWORD_CHANGED, {
      actorId: userId,
      actorRole: user.role,
    });
  }

  async changePin(
    userId: string,
    currentPin: string,
    newPin: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pinHash) {
      throw new InvalidCredentialsException();
    }

    const isValid = await this.pinService.verify(user.pinHash, currentPin);
    if (!isValid) {
      throw new InvalidCredentialsException('Current PIN is incorrect');
    }

    const newPinHash = await this.pinService.hash(newPin);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinHash: newPinHash,
        mustChangePassword: false,
      },
    });

    await this.auditService.log(AuditEvent.PIN_CHANGED, {
      actorId: userId,
      actorRole: user.role,
    });
  }

  // ---------------------------------------------------------------------------
  // Password reset flow
  // ---------------------------------------------------------------------------

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { email } });

    // Don't reveal whether the email exists
    if (!user?.emailVerifiedAt) {
      return {
        message: 'Si el correo existe, recibirás un enlace de recuperación.',
      };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    this.passwordResetTokens.set(resetToken, { userId: user.id, expiresAt });
    setTimeout(() => this.passwordResetTokens.delete(resetToken), 60 * 60 * 1000);

    await this.auditService.log(AuditEvent.FORGOT_PASSWORD, {
      actorId: user.id,
      actorRole: user.role,
      details: { email },
    });

    this.logger.log(
      `Password reset requested for ${email}. Token: ${resetToken}`,
    );

    return {
      message: 'Si el correo existe, recibirás un enlace de recuperación.',
    };
  }

  async resetPassword(
    resetToken: string,
    newPassword: string,
  ): Promise<void> {
    const stored = this.passwordResetTokens.get(resetToken);
    if (!stored || new Date() > stored.expiresAt) {
      throw new InvalidCredentialsException('Invalid or expired reset token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
    });
    if (!user) {
      throw new InvalidCredentialsException('User not found');
    }

    const { hash: newHash, algorithm } = await this.passwordHasher.hash(
      newPassword,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        passwordAlgorithm: algorithm,
        lastPasswordChangeAt: new Date(),
        mustChangePassword: false,
      },
    });

    this.passwordResetTokens.delete(resetToken);

    await this.sessionService.revokeUserSessions(
      user.id,
      SessionRevocationReason.PASSWORD_CHANGED,
    );

    await this.auditService.log(AuditEvent.PASSWORD_RESET_COMPLETED, {
      actorId: user.id,
      actorRole: user.role,
    });
  }

  // ---------------------------------------------------------------------------
  // Session limit
  // ---------------------------------------------------------------------------

  getSessionLimit(role: string): number {
    switch (role) {
      case 'CASHIER':
        return 3;
      case 'MANAGER':
        return 5;
      case 'OWNER':
        return 10;
      case 'SAAS_ADMIN':
        return 5;
      default:
        return 3;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: session issuance
  // ---------------------------------------------------------------------------

  private async issueSessionInternal(
    user: PrismaUser,
    params: CreateSessionParams,
  ): Promise<AuthResponseData> {
    const accessTokenTtl = this.configService.get('JWT_ACCESS_TTL_SECONDS')!;
    const refreshTokenTtl = this.configService.get('JWT_REFRESH_TTL_SECONDS')!;

    const tokenHash = this.hashToken(crypto.randomBytes(32).toString('hex'));
    const refreshTokenHash = this.hashToken(
      crypto.randomBytes(32).toString('hex'),
    );

    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + accessTokenTtl * 1000);
    const refreshExpiresAt = new Date(now.getTime() + refreshTokenTtl * 1000);

    const jwtPayload = {
      sub: user.id,
      tokenHash,
      jti: crypto.randomUUID(),
      sessionId: null as string | null,
      role: user.role,
      subscriptionId: user.subscriptionId,
    };

    const accessToken = this.jwtService.sign(jwtPayload, {
      expiresIn: accessTokenTtl,
    });

    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        refreshTokenHash,
        jti: crypto.randomUUID(),
      },
      { expiresIn: refreshTokenTtl },
    );

    const sessionLimit = this.getSessionLimit(user.role);

    const session = await this.sessionService.createSession({
      userId: user.id,
      workstationId: params.workstationId,
      tokenHash,
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      workstationFingerprint: params.hardwareFingerprint,
      deviceInfo: params.deviceInfo,
    });

    const { evictedSessionId } = await this.sessionService.enforceSessionLimit(
      user.id,
      sessionLimit,
      session.id,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        lastLoginWorkstationId: params.workstationId,
      },
    });

    const userDto = this.toSafeUser(user);

    await this.auditService.log(AuditEvent.LOGIN_SUCCESS, {
      actorId: user.id,
      actorRole: user.role,
      workstationId: params.workstationId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      sessionId: session.id,
      details: evictedSessionId
        ? { evictedSessionId, sessionLimit }
        : undefined,
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: accessExpiresAt,
      user: userDto,
      sessionId: session.id,
      evictedSessionId: evictedSessionId ?? undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: account state helpers
  // ---------------------------------------------------------------------------

  private async handleFailedLoginAttempt(
    userId: string,
    identifier: string,
    sessionType: 'PASSWORD' | 'PIN',
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return;
    }

    const newFailedAttempts = user.failedLoginAttempts + 1;

    // Escalating lockout durations
    let lockDurationMinutes = ACCOUNT_LOCK_DURATION_MINUTES;
    if (newFailedAttempts >= 20) {
      lockDurationMinutes = 24 * 60; // 24 hours
    } else if (newFailedAttempts >= 10) {
      lockDurationMinutes = 60; // 1 hour
    }

    const lockedUntil =
      newFailedAttempts >= 5
        ? new Date(Date.now() + lockDurationMinutes * 60 * 1000)
        : null;

    if (lockedUntil) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newFailedAttempts,
          lockedUntil,
          status: UserStatus.LOCKED,
        },
      });

      await this.auditService.log(AuditEvent.ACCOUNT_LOCKED, {
        actorId: userId,
        actorRole: user.role,
        details: {
          failedAttempts: newFailedAttempts,
          lockDurationMinutes,
          identifier,
        },
      });

      if (newFailedAttempts >= 20) {
        this.logger.warn(
          `User ${userId} locked after ${newFailedAttempts} failed attempts. Admin intervention required.`,
        );
      }

      throw new AccountLockedException(lockedUntil);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: newFailedAttempts },
    });

    await this.auditService.log(AuditEvent.LOGIN_FAILURE, {
      actorId: userId,
      actorRole: user.role,
      details: { failedAttempts: newFailedAttempts, identifier, sessionType },
    });
  }

  private async resetFailedLoginAttempts(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        status: UserStatus.ACTIVE,
      },
    });
  }

  private assertAccountIsUsable(
    user: PrismaUser | null,
  ): asserts user is PrismaUser {
    if (!user) {
      throw new InvalidCredentialsException();
    }

    if (!user.isActive || user.status === UserStatus.DISABLED) {
      throw new AccountInactiveException();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AccountLockedException(user.lockedUntil);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: DTO mapping
  // ---------------------------------------------------------------------------

  private toSafeUser(dbUser: PrismaUser): User {
    return {
      id: dbUser.id,
      subscriptionId: dbUser.subscriptionId,
      role: dbUser.role as User['role'],
      email: dbUser.email,
      username: dbUser.username,
      displayName: dbUser.displayName ?? dbUser.fullName,
      firstName: undefined,
      lastName: undefined,
      avatarUrl: dbUser.avatarUrl,
      avatarColor: dbUser.avatarColor,
      authMethod: dbUser.authMethod as User['authMethod'],
      identificationType: null,
      identificationNumber: null,
      isActive: dbUser.isActive,
      totpEnabled: dbUser.totpEnabled,
      failedLoginAttempts: dbUser.failedLoginAttempts,
      lockedUntil: dbUser.lockedUntil,
      passwordHash: dbUser.passwordHash ?? undefined,
      passwordAlgorithm: dbUser.passwordAlgorithm ?? undefined,
      emailVerifiedAt: dbUser.emailVerifiedAt,
      lastLoginAt: dbUser.lastLoginAt,
      lastPasswordChangeAt: dbUser.lastPasswordChangeAt,
      status: dbUser.status as User['status'],
      mustChangePassword: dbUser.mustChangePassword,
      createdByUserId: dbUser.createdById,
      createdAt: dbUser.createdAt.toISOString(),
      updatedAt: dbUser.updatedAt.toISOString(),
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
