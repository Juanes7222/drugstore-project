import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { acquireAdvisoryLock } from '@/common/utils/advisory-lock';
import { EnvConfig } from '@/config/env.schema';
import {
  AuthMethod,
  RoleType,
  SessionRevocationReason,
  UserStatus,
} from '@pharmacy/database';
import type { Prisma, User as PrismaUser } from '@pharmacy/database';
import { User } from '@pharmacy/shared-types';
import * as crypto from 'node:crypto';
import { PasswordHasherService } from './services/password-hasher.service';
import { PinService } from './services/pin.service';
import { TotpService } from './services/totp.service';
import { BackupCodesService } from './services/backup-codes.service';
import { SessionService } from './services/session.service';
import { AuditService, AuditEvent } from './services/audit.service';
import { OfflineTokenService } from './offline/offline-token.service';
import { CredentialCacheService } from './offline/credential-cache.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';
import { FirebaseEmailConflictException } from './exceptions/firebase-email-conflict.exception';
import { AccountLockedException } from './exceptions/account-locked.exception';
import { AccountInactiveException } from './exceptions/account-inactive.exception';
import { SessionExpiredException } from './exceptions/session-expired.exception';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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
  offlineToken?: {
    token: string;
    expiresAt: Date;
  };
  credentialVerificationKey?: {
    encryptedBlob: string;
    keyFingerprint: string;
    version: number;
  };
}

/** Safe projection of a user returned by the SAAS_ADMIN bootstrap endpoint. */
export interface BootstrapSaasAdminResult {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  status: string;
  isActive: boolean;
  authMethod: string;
  emailVerifiedAt: Date | null;
  createdAt: string;
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
    private readonly offlineTokenService: OfflineTokenService,
    private readonly credentialCacheService: CredentialCacheService,
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
        OR: [{ username: identifier }, { email: identifier }],
      },
    });

    this.assertAccountIsUsable(user);

    let isValid: boolean;

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
    workstationId?: string;
    workstationName?: string;
    hardwareFingerprint?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: string;
  }): Promise<AuthResponseData> {
    // Web backoffice sessions have no POS terminal; fall back to the shared
    // WEB_ADMIN virtual workstation when none is supplied. Unknown POS ids
    // self-register here (first login from a new machine).
    const { workstationId: suppliedWorkstationId, ...restParams } = params;
    const resolvedParams = {
      ...restParams,
      workstationId: await this.ensureWorkstation(
        suppliedWorkstationId,
        params.workstationName,
      ),
    };

    const user = await this.validateCredentials(
      resolvedParams.identifier,
      resolvedParams.secret,
      resolvedParams.sessionType,
    );

    if (user.totpEnabled && resolvedParams.sessionType === 'PASSWORD') {
      const challengeToken = crypto.randomUUID();
      this.twoFactorChallenges.set(challengeToken, {
        userId: user.id,
        identifier: resolvedParams.identifier,
        workstationId: resolvedParams.workstationId,
        ipAddress: resolvedParams.ipAddress,
        userAgent: resolvedParams.userAgent,
        createdAt: new Date(),
      });

      // Auto-clean after 5 minutes
      setTimeout(
        () => this.twoFactorChallenges.delete(challengeToken),
        5 * 60 * 1000,
      );

      await this.auditService.log(AuditEvent.LOGIN_SUCCESS, {
        actorId: user.id,
        actorRole: user.role,
        workstationId: resolvedParams.workstationId,
        ipAddress: resolvedParams.ipAddress,
        userAgent: resolvedParams.userAgent,
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

    return this.issueSessionInternal(user, resolvedParams);
  }

  // ---------------------------------------------------------------------------
  // Firebase (Google) login
  // ---------------------------------------------------------------------------

  /**
   * Authenticate a user already verified by Firebase (Google sign-in).
   * Resolves the local account by Firebase uid, falling back to the verified
   * email, and creates a local account on first sign-in. If the verified email
   * matches an existing password-protected account, the request is rejected to
   * prevent a Google identity from taking over that account.
   */
  async loginWithFirebase(params: {
    firebaseUid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    workstationId?: string;
    workstationName?: string;
    hardwareFingerprint?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: string;
  }): Promise<AuthResponseData> {
    // Same WEB_ADMIN fallback as password login: Firebase login is also
    // used by the web backoffice without a POS terminal. Unknown POS ids
    // self-register here (first login from a new machine).
    const { workstationId: suppliedWorkstationId, ...restParams } = params;
    const resolvedParams = {
      ...restParams,
      workstationId: await this.ensureWorkstation(
        suppliedWorkstationId,
        params.workstationName,
      ),
    };

    let user = await this.prisma.user.findFirst({
      where: { firebaseUid: params.firebaseUid },
    });

    if (!user && params.email) {
      const byEmail = await this.prisma.user.findFirst({
        where: { email: params.email },
      });
      if (byEmail?.passwordHash) {
        throw new FirebaseEmailConflictException();
      }
      // An email may already be bound to a different Google identity. Do not
      // let one Google account take over another's local profile.
      if (byEmail?.firebaseUid && byEmail.firebaseUid !== params.firebaseUid) {
        throw new FirebaseEmailConflictException();
      }
      user = byEmail;
    }

    if (!user) {
      // Self-registration: gate by email-domain allowlist when configured,
      // and create the account in PENDING_SETUP so an admin must approve it
      // before it can log in (assertAccountIsUsable rejects inactive users).
      this.assertEmailDomainAllowed(params.email);
      user = await this.prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          role: 'OWNER',
          email: params.email,
          fullName: params.displayName ?? params.email ?? 'Google User',
          displayName: params.displayName,
          avatarUrl: params.photoURL,
          authMethod: 'OAUTH_GOOGLE',
          emailVerifiedAt: params.email ? new Date() : null,
          status: UserStatus.PENDING_SETUP,
          isActive: false,
          firebaseUid: params.firebaseUid,
        },
      });
    } else if (!user.firebaseUid) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          firebaseUid: params.firebaseUid,
          authMethod: 'OAUTH_GOOGLE',
          emailVerifiedAt: params.email ? new Date() : user.emailVerifiedAt,
        },
      });
      user.firebaseUid = params.firebaseUid;
      user.authMethod = 'OAUTH_GOOGLE';
      user.emailVerifiedAt = params.email ? new Date() : user.emailVerifiedAt;
    }

    this.assertAccountIsUsable(user);

    return this.issueSessionInternal(user, {
      identifier: resolvedParams.email ?? resolvedParams.firebaseUid,
      workstationId: resolvedParams.workstationId,
      ipAddress: resolvedParams.ipAddress,
      userAgent: resolvedParams.userAgent,
      hardwareFingerprint: resolvedParams.hardwareFingerprint,
      deviceInfo: resolvedParams.deviceInfo,
    });
  }

  // ---------------------------------------------------------------------------
  // Bootstrap (first SAAS_ADMIN provisioning)
  // ---------------------------------------------------------------------------

  /**
   * Provision the first SAAS_ADMIN account. Called by POST /auth/bootstrap
   * after the controller has verified the BOOTSTRAP_TOKEN. Idempotent by
   * email: an existing account is promoted to SAAS_ADMIN instead of
   * creating a duplicate.
   */
  async bootstrapSaasAdmin(params: {
    email: string;
    displayName?: string;
  }): Promise<BootstrapSaasAdminResult> {
    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: params.email, mode: 'insensitive' },
      },
    });

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            role: RoleType.SAAS_ADMIN,
            status: UserStatus.ACTIVE,
            isActive: true,
            authMethod: AuthMethod.PASSWORD_ONLY,
            emailVerifiedAt: new Date(),
          },
        })
      : await this.prisma.user.create({
          data: {
            id: crypto.randomUUID(),
            email: params.email,
            username: params.email.split('@')[0] ?? null,
            fullName: params.displayName ?? params.email,
            displayName: params.displayName ?? null,
            role: RoleType.SAAS_ADMIN,
            status: UserStatus.ACTIVE,
            isActive: true,
            authMethod: AuthMethod.PASSWORD_ONLY,
            emailVerifiedAt: new Date(),
          },
        });

    await this.auditService.log(AuditEvent.USER_CREATED, {
      actorId: null,
      actorRole: null,
      targetType: 'User',
      targetId: user.id,
      details: {
        role: RoleType.SAAS_ADMIN,
        source: 'bootstrap',
        promoted: Boolean(existing),
      },
    });

    return this.toSafeBootstrapUser(user);
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
      verified = this.totpService.verify(
        user.totpSecretEncrypted,
        params.totpCode,
      );
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
  async validateActiveSession(
    userId: string,
    tokenHash: string,
  ): Promise<User> {
    const session =
      await this.sessionService.findActiveSessionByTokenHash(tokenHash);

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

    if (
      user.status !== UserStatus.ACTIVE &&
      user.status !== UserStatus.PENDING_SETUP
    ) {
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
   * Look up a user by ID and return the safe public DTO.
   * Validates that the user exists and is active (same checks as
   * `validateActiveSession` minus the session token lookup).  Used by
   * `SyncAuthGuard` to authenticate sync requests with an offline token
   * when the short-lived access token has already expired.
   *
   * @throws `UnauthorizedException` if user not found or inactive
   */
  async getActiveUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return this.toSafeUser(user);
  }

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
   *
   * The session's lifetime is the refresh TTL (session.expiresAt is set to
   * the refresh TTL at issue time), so this works with an expired access
   * token as long as the session is still inside its refresh window.
   */
  async refreshSession(
    refreshTokenHash: string,
    userId?: string,
  ): Promise<{ accessToken: string; expiresAt: Date; refreshToken: string }> {
    // The controller extracts tokenHash from the access JWT payload,
    // which is the session's access token hash (tokenHash), NOT the
    // refresh token hash.  Use findActiveSessionByTokenHash to match.
    const session =
      await this.sessionService.findActiveSessionByTokenHash(refreshTokenHash);

    if (!session) {
      // Check if the refresh token was already used (reuse detection).
      // The controller sends tokenHash from the access JWT, which is the
      // session's access token hash (stored in both tokenHash and, during
      // a prior refresh, may have been replaced with a new hash).  Search
      // by both fields to catch the reuse regardless of which hash column
      // the old token's hash ends up matching.
      const reusedSession = await this.prisma.userSession.findFirst({
        where: {
          OR: [{ refreshTokenHash }, { tokenHash: refreshTokenHash }],
        },
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

    if (userId && session.userId !== userId) {
      // The token belongs to a different session/user than the one the
      // caller claims. Treat as invalid — never rotate another user's session.
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
    // The session's own lifetime stays at the refresh TTL — writing the
    // short access TTL here would expire the session a few minutes after
    // the first refresh and force an early re-login.
    const refreshExpiresAt = new Date(now.getTime() + refreshTokenTtl * 1000);

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
      refreshExpiresAt,
    );

    await this.auditService.log(AuditEvent.REFRESH_TOKEN, {
      actorId: session.userId,
      actorRole: null,
      sessionId: session.id,
    });

    return { accessToken, refreshToken, expiresAt };
  }

  // ---------------------------------------------------------------------------
  // Offline token exchange
  // ---------------------------------------------------------------------------

  /**
   * Exchange an offline token for fresh credentials.
   *
   * This is the fallback mechanism for the SyncScheduler when the access
   * token has already expired (the standard `POST /auth/refresh` fails
   * because JwtAuthGuard rejects the expired token).
   *
   * The offline token is a long-lived JWT (14–30 days) that this endpoint
   * validates directly — without requiring a currently-valid access token.
   * If valid, both access and refresh tokens are rotated, the session's
   * token hashes are updated in the database, a new offline token is issued
   * (the old one is revoked for rotation), and the fresh credentials are
   * returned to the caller.
   */
  async exchangeOfflineToken(offlineTokenJwt: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    offlineToken: { token: string; expiresAt: Date };
  }> {
    // 1. Verify the offline token signature and claims
    const claims = this.offlineTokenService.verifyToken(offlineTokenJwt);
    if (!claims) {
      throw new UnauthorizedException('Invalid offline token');
    }

    // 2. Check the revocation list
    const isRevoked = await this.offlineTokenService.isRevoked(claims.jti);
    if (isRevoked) {
      throw new UnauthorizedException('Offline token has been revoked');
    }

    // 3. Verify user is still active
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        isActive: true,
        status: true,
        role: true,
        subscriptionId: true,
        lockedUntil: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (!user.isActive || user.status === 'DISABLED') {
      await this.offlineTokenService.revokeToken({
        jti: claims.jti,
        userId: user.id,
        reason: 'USER_DISABLED',
        reasonDetail: 'User account is not active during token exchange',
      });
      throw new UnauthorizedException('User account is not active');
    }
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new UnauthorizedException('User account is locked');
    }

    // 4. Check user-level revocation since token issuance
    const tokenIssuedAt = new Date(claims.iat * 1000);
    const userRevoked = await this.offlineTokenService.isUserRevokedSince(
      user.id,
      tokenIssuedAt,
    );
    if (userRevoked) {
      throw new UnauthorizedException('User credentials have been revoked');
    }

    // 5. Issue fresh tokens
    const accessTokenTtl = this.configService.get('JWT_ACCESS_TTL_SECONDS')!;
    const refreshTokenTtl = this.configService.get('JWT_REFRESH_TTL_SECONDS')!;

    const newTokenHash = this.hashToken(crypto.randomBytes(32).toString('hex'));
    const newRefreshTokenHash = this.hashToken(
      crypto.randomBytes(32).toString('hex'),
    );

    const accessExpiresAt = new Date(now.getTime() + accessTokenTtl * 1000);
    const refreshExpiresAt = new Date(now.getTime() + refreshTokenTtl * 1000);

    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        tokenHash: newTokenHash,
        jti: crypto.randomUUID(),
        role: user.role,
        subscriptionId: user.subscriptionId,
      },
      { expiresIn: accessTokenTtl },
    );

    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        refreshTokenHash: newRefreshTokenHash,
        jti: crypto.randomUUID(),
      },
      { expiresIn: refreshTokenTtl },
    );

    // 6. Update the existing session's token hashes (find by sessionId from claims)
    const existingSession = await this.prisma.userSession.findFirst({
      where: {
        id: claims.sid,
        status: 'ACTIVE',
      },
    });

    if (existingSession) {
      await this.sessionService.updateSessionTokens(
        existingSession.id,
        newTokenHash,
        newRefreshTokenHash,
        accessExpiresAt,
      );
    }

    // 7. Issue a new offline token (rotation)
    const locationAccess = await this.prisma.userLocationAccess.findMany({
      where: { userId: user.id },
      select: { locationId: true },
    });
    const locationIds = locationAccess.map((la) => la.locationId);

    const newOfflineToken = await this.offlineTokenService.issueToken({
      userId: user.id,
      role: user.role,
      subscriptionId: user.subscriptionId,
      locationIds,
      workstationId: existingSession?.workstationId ?? '',
      workstationFingerprint: claims.wfp,
      sessionId: existingSession?.id ?? crypto.randomUUID(),
    });

    // 8. Revoke the old offline token (it's been replaced)
    await this.offlineTokenService.revokeToken({
      jti: claims.jti,
      userId: user.id,
      reason: 'SECURITY_ANOMALY',
      reasonDetail: 'Replaced by token exchange',
    });

    this.logger.log(
      `Offline token exchanged for user ${user.id} (${user.role}), new token expires in ${accessTokenTtl}s`,
    );

    return {
      accessToken,
      refreshToken,
      expiresAt: accessExpiresAt,
      offlineToken: {
        token: newOfflineToken.token,
        expiresAt: newOfflineToken.expiresAt,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  async logoutSession(tokenHash: string): Promise<void> {
    const session =
      await this.sessionService.findActiveSessionByTokenHash(tokenHash);

    if (!session) {
      return; // Idempotent
    }

    await this.sessionService.revokeSession(
      session.id,
      SessionRevocationReason.LOGOUT,
    );

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

    const { hash: newHash, algorithm } =
      await this.passwordHasher.hash(newPassword);

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

    // Invalidate offline tokens so POS workstations force re-login
    await this.offlineTokenService.revokeAllUserTokens(
      userId,
      'PASSWORD_CHANGED',
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

    // Invalidate offline tokens so other POS sessions force re-login
    await this.offlineTokenService.revokeAllUserTokens(userId, 'PIN_CHANGED');

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
    setTimeout(
      () => this.passwordResetTokens.delete(resetToken),
      60 * 60 * 1000,
    );

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

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
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

    const { hash: newHash, algorithm } =
      await this.passwordHasher.hash(newPassword);

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

  /**
   * Resolve the shared WEB_ADMIN virtual workstation used for web
   * backoffice sessions. Creates it on first use.
   */
  private async resolveWebWorkstationId(): Promise<string> {
    const workstation = await this.prisma.workstation.upsert({
      where: { code: 'WEB_ADMIN' },
      create: {
        id: crypto.randomUUID(),
        name: 'Web Admin',
        code: 'WEB_ADMIN',
        isActive: true,
        registeredAt: new Date(),
      },
      update: {},
      select: { id: true },
    });
    return workstation.id;
  }

  /**
   * Resolve the workstation a login comes from, self-registering unknown
   * machines. A POS install generates its own stable workstation id and
   * persists it locally; the first login from that machine creates the row
   * here, so no seeding step is needed when a pharmacy plugs in another PC.
   * The licensing layer still caps how many of these can be ACTIVATED per
   * location (plan.maxWorkstationsPerLocation) — registration itself is free.
   *
   * Serialized by an advisory lock keyed on the supplied id: two logins from
   * the same new machine racing would otherwise both try to create the row.
   */
  private async ensureWorkstation(
    suppliedWorkstationId?: string,
    workstationName?: string,
  ): Promise<string> {
    if (!suppliedWorkstationId) {
      return this.resolveWebWorkstationId();
    }

    const existing = await this.prisma.workstation.findUnique({
      where: { id: suppliedWorkstationId },
      select: { id: true },
    });
    if (existing) return existing.id;

    return this.prisma.$transaction(async (tx) => {
      await acquireAdvisoryLock(
        tx,
        `${suppliedWorkstationId}:WORKSTATION_SELF_REGISTER`,
      );

      const raced = await tx.workstation.findUnique({
        where: { id: suppliedWorkstationId },
        select: { id: true },
      });
      if (raced) return raced.id;

      const created = await tx.workstation.create({
        data: {
          id: suppliedWorkstationId,
          code: await this.generateWorkstationCode(tx),
          name: await this.generateWorkstationName(
            tx,
            suppliedWorkstationId,
            workstationName,
          ),
          isActive: true,
          registeredAt: new Date(),
        },
        select: { id: true, name: true },
      });
      this.logger.log(
        `Self-registered workstation ${created.id} (${created.name})`,
      );
      return created.id;
    });
  }

  /** Unique machine-readable code for a self-registered workstation. */
  private async generateWorkstationCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `AUTO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const clash = await tx.workstation.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new Error('Could not generate a unique workstation code');
  }

  /**
   * Unique display name: uses the client-supplied label when available and
   * disambiguates collisions with an id fragment (name is @unique).
   */
  private async generateWorkstationName(
    tx: Prisma.TransactionClient,
    workstationId: string,
    requestedName?: string,
  ): Promise<string> {
    const candidates = [
      ...(requestedName ? [requestedName] : []),
      `POS ${workstationId.slice(-4).toUpperCase()}`,
    ];
    for (const candidate of candidates) {
      const clash = await tx.workstation.findFirst({
        where: { name: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    // Both candidates taken — fall back to the id fragment suffix, which is
    // unique per workstation by construction.
    return `${requestedName ?? 'POS'} (${workstationId.slice(-4).toUpperCase()})`;
  }

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

    // ------------------------------------------------------------------
    // Offline token & credential verification key (CVK) issuance
    // ------------------------------------------------------------------

    // Fetch user's location access for the offline token claims
    const locationAccess = await this.prisma.userLocationAccess.findMany({
      where: { userId: user.id },
      select: { locationId: true },
    });
    const locationIds = locationAccess.map((la) => la.locationId);

    // Issue offline token (long-lived JWT bound to workstation)
    const offlineToken = await this.offlineTokenService.issueToken({
      userId: user.id,
      role: user.role,
      subscriptionId: user.subscriptionId,
      locationIds,
      workstationId: params.workstationId,
      workstationFingerprint: params.hardwareFingerprint ?? '',
      sessionId: session.id,
    });

    // Generate credential verification key (encrypted credential blob)
    const cvk = await this.credentialCacheService.generateCvk({
      userId: user.id,
      passwordHash: user.passwordHash,
      pinHash: user.pinHash,
      workstationFingerprint: params.hardwareFingerprint ?? '',
      expiresAt: offlineToken.expiresAt,
    });

    await this.auditService.log(AuditEvent.LOGIN_SUCCESS, {
      actorId: user.id,
      actorRole: user.role,
      workstationId: params.workstationId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      sessionId: session.id,
      details: {
        ...(evictedSessionId ? { evictedSessionId, sessionLimit } : {}),
        offlineTokenIssued: true,
        offlineTokenExpiresAt: offlineToken.expiresAt.toISOString(),
      },
    });

    await this.auditService.log(AuditEvent.OFFLINE_CREDENTIALS_CACHED, {
      actorId: user.id,
      actorRole: user.role,
      workstationId: params.workstationId,
      sessionId: session.id,
      details: {
        cvkVersion: cvk.version,
        expiresAt: offlineToken.expiresAt.toISOString(),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: accessExpiresAt,
      user: userDto,
      sessionId: session.id,
      evictedSessionId: evictedSessionId ?? undefined,
      offlineToken: {
        token: offlineToken.token,
        expiresAt: offlineToken.expiresAt,
      },
      credentialVerificationKey: {
        encryptedBlob: cvk.encryptedBlob,
        keyFingerprint: cvk.keyFingerprint,
        version: cvk.version,
      },
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
    // Atomic increment, then re-read: two concurrent failed logins must not
    // both read the same count and write the same successor, which would let
    // an attacker drift past the lockout thresholds without ever triggering
    // them (read-modify-write race).
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { failedLoginAttempts: true, role: true },
    });

    if (!user) {
      return;
    }

    const newFailedAttempts = user.failedLoginAttempts;

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

  /**
   * Enforce BACKOFFICE_ALLOWED_DOMAINS on self-registration. When the env var
   * is set, only verified Google accounts whose email domain is listed may
   * create a local account; existing accounts are never affected. The list
   * contents are deliberately not echoed back to the caller.
   */
  private assertEmailDomainAllowed(email: string | null): void {
    const rawAllowlist: string | undefined = this.configService.get(
      'BACKOFFICE_ALLOWED_DOMAINS',
    );
    if (!rawAllowlist) {
      return; // Allowlist disabled — registration is unrestricted
    }

    const allowedDomains = rawAllowlist
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain.length > 0);

    if (allowedDomains.length === 0) {
      return;
    }

    const domain = email?.split('@')[1]?.toLowerCase();
    if (!domain || !allowedDomains.includes(domain)) {
      throw new ForbiddenException(
        'Self-registration is restricted to allowed email domains',
      );
    }
  }

  /**
   * Project a user to the bootstrap response shape, deliberately excluding
   * passwordHash, pinHash and other sensitive credential fields.
   */
  private toSafeBootstrapUser(user: PrismaUser): BootstrapSaasAdminResult {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      isActive: user.isActive,
      authMethod: user.authMethod,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private: DTO mapping
  // ---------------------------------------------------------------------------

  private toSafeUser(dbUser: PrismaUser): User {
    return {
      id: dbUser.id,
      subscriptionId: dbUser.subscriptionId,
      role: dbUser.role as User['role'],
      isPlatformAdmin: dbUser.isPlatformAdmin,
      email: dbUser.email,
      username: dbUser.username,
      displayName: dbUser.displayName ?? dbUser.fullName,
      firstName: undefined,
      lastName: undefined,
      avatarUrl: dbUser.avatarUrl,
      avatarColor: dbUser.avatarColor,
      authMethod: dbUser.authMethod as User['authMethod'],
      // Presence flags only: the POS login screen needs to know which
      // credential types an account supports (PIN vs password prompt);
      // the hashes themselves are never projected onto this DTO.
      hasPin: dbUser.pinHash != null,
      hasPassword: dbUser.passwordHash != null,
      identificationType: null,
      identificationNumber: null,
      isActive: dbUser.isActive,
      totpEnabled: dbUser.totpEnabled,
      failedLoginAttempts: dbUser.failedLoginAttempts,
      lockedUntil: dbUser.lockedUntil,
      // Credential material must never leave the server. Offline login uses
      // the encrypted credentialVerificationKey issued alongside this DTO.
      emailVerifiedAt: dbUser.emailVerifiedAt,
      lastLoginAt: dbUser.lastLoginAt,
      lastLoginWorkstationId: dbUser.lastLoginWorkstationId ?? null,
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
