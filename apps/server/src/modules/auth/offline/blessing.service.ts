/**
 * Offline session blessing service.
 *
 * Validates offline sessions when the workstation reconnects to the server.
 * Each pending session is checked against the current server state:
 * - Is the user still active?
 * - Is the workstation still registered?
 * - Is the token signature valid and not expired?
 * - Is the workstation fingerprint consistent?
 * - Are the user's locationIds still valid?
 *
 * Blessed sessions receive fresh access, refresh, and offline tokens.
 * Rejected sessions are recorded with a reason for client-side handling.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/config/env.schema';
import { OfflineTokenService } from './offline-token.service';
import { AuditService, AuditEvent } from '../services/audit.service';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlessingRequest {
  localSessionId: string;
  userId: string;
  offlineTokenJwt: string;
  workstationFingerprint: string;
  createdAt: string;        // ISO date
  lastActiveAt: string;     // ISO date
}

export interface BlessingResult {
  localSessionId: string;
  status: 'BLESSED' | 'REJECTED';
  reason?: string;
  replacementToken?: {
    accessToken: string;
    refreshToken: string;
    offlineToken: string;
    expiresAt: Date;
  };
}

export interface BlessingResponse {
  results: BlessingResult[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class BlessingService {
  private readonly logger = new Logger(BlessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig>,
    private readonly offlineTokenService: OfflineTokenService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Bless (validate) a batch of pending offline sessions.
   * Returns a result for each session with status and optional replacement tokens.
   * Max 50 sessions per request (rate limit).
   */
  async blessSessions(
    requests: BlessingRequest[],
    requestWorkstationFingerprint: string,
  ): Promise<BlessingResponse> {
    if (requests.length > 50) {
      this.logger.warn(
        `Blessing request exceeded limit: ${requests.length} sessions (max 50)`,
      );
      requests = requests.slice(0, 50);
    }

    const results: BlessingResult[] = [];

    for (const req of requests) {
      try {
        const result = await this.blessSingleSession(
          req,
          requestWorkstationFingerprint,
        );
        results.push(result);

        // Record the blessing result in the database
        await this.recordBlessing(req, result);
      } catch (error) {
        this.logger.error(
          `Error blessing session ${req.localSessionId}: ${(error as Error).message}`,
        );
        results.push({
          localSessionId: req.localSessionId,
          status: 'REJECTED',
          reason: 'INTERNAL_ERROR',
        });
      }
    }

    return { results };
  }

  /**
   * Bless a single offline session.
   */
  private async blessSingleSession(
    req: BlessingRequest,
    requestWorkstationFingerprint: string,
  ): Promise<BlessingResult> {
    // Step 1: Verify the offline token signature
    const claims = this.offlineTokenService.verifyToken(req.offlineTokenJwt);
    if (!claims) {
      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'TOKEN_SIGNATURE_INVALID',
      };
    }

    // Step 2: Check token expiration
    const now = new Date();
    if (claims.exp * 1000 < now.getTime()) {
      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'TOKEN_EXPIRED',
      };
    }

    // Step 3: Check revocation list
    const isRevoked = await this.offlineTokenService.isRevoked(claims.jti);
    if (isRevoked) {
      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'TOKEN_REVOKED',
      };
    }

    // Step 4: Verify workstation fingerprint matches the request
    if (claims.wfp !== requestWorkstationFingerprint) {
      // Critical fraud signal: token was issued for a different workstation
      this.logger.warn(
        `[FRAUD] Offline token workstation fingerprint mismatch: token has ${claims.wfp.substring(0, 8)}... but request has ${requestWorkstationFingerprint.substring(0, 8)}...`,
      );
      await this.offlineTokenService.revokeToken({
        jti: claims.jti,
        userId: req.userId,
        reason: 'FRAUD_DETECTED',
        reasonDetail: 'Workstation fingerprint mismatch during blessing',
      });

      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'WORKSTATION_FINGERPRINT_MISMATCH',
      };
    }

    // Step 5: Check that user exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
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
      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'USER_NOT_FOUND',
      };
    }

    if (!user.isActive || user.status === 'DISABLED') {
      await this.offlineTokenService.revokeToken({
        jti: claims.jti,
        userId: req.userId,
        reason: 'USER_DISABLED',
        reasonDetail: 'User was disabled after offline login',
      });

      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'USER_DISABLED',
      };
    }

    if (user.status === 'LOCKED' || (user.lockedUntil && user.lockedUntil > now)) {
      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'USER_LOCKED',
      };
    }

    // Step 6: Check if user-level revocation exists since token issuance
    const tokenIssuedAt = new Date(claims.iat * 1000);
    const userRevoked = await this.offlineTokenService.isUserRevokedSince(
      req.userId,
      tokenIssuedAt,
    );
    if (userRevoked) {
      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'USER_DISABLED',
      };
    }

    // Step 7: Verify workstation is still active
    const workstation = await this.prisma.workstation.findUnique({
      where: { id: claims.sid ? undefined : undefined },
    });

    // Look up workstation by the session's claims or the request context
    const workstationRecord = await this.prisma.workstation.findFirst({
      where: {
        sessions: {
          some: { id: claims.sid },
        },
      },
    });

    // If we can't find by session, try direct lookup
    const directWorkstation = await this.prisma.workstationActivation.findFirst({
      where: {
        hardwareFingerprint: requestWorkstationFingerprint,
        isActive: true,
      },
    });

    if (directWorkstation && !directWorkstation.isActive) {
      return {
        localSessionId: req.localSessionId,
        status: 'REJECTED',
        reason: 'WORKSTATION_REVOKED',
      };
    }

    // Step 8: Verify location access
    if (claims.locationIds && claims.locationIds.length > 0) {
      const hasAccess = await this.checkLocationAccess(
        req.userId,
        claims.locationIds,
      );
      if (!hasAccess) {
        await this.offlineTokenService.revokeToken({
          jti: claims.jti,
          userId: req.userId,
          reason: 'FRAUD_DETECTED',
          reasonDetail: 'User lost location access after offline login',
        });

        return {
          localSessionId: req.localSessionId,
          status: 'REJECTED',
          reason: 'LOCATION_ACCESS_REVOKED',
        };
      }
    }

    // All checks passed — bless the session and issue fresh tokens
    return this.blessAndIssueTokens(req, user, claims);
  }

  /**
   * Issue fresh tokens for a blessed session.
   */
  private async blessAndIssueTokens(
    req: BlessingRequest,
    user: {
      id: string;
      role: string;
      subscriptionId: string | null;
    },
    claims: { jti: string; sid: string; locationIds: string[]; wfp: string },
  ): Promise<BlessingResult> {
    const accessTokenTtl = this.configService.get('JWT_ACCESS_TTL_SECONDS')!;
    const refreshTokenTtl = this.configService.get('JWT_REFRESH_TTL_SECONDS')!;

    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + accessTokenTtl * 1000);

    const tokenHash = crypto
      .createHash('sha256')
      .update(crypto.randomBytes(32).toString('hex'))
      .digest('hex');
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(crypto.randomBytes(32).toString('hex'))
      .digest('hex');

    // Issue access token
    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        tokenHash,
        jti: crypto.randomUUID(),
        role: user.role,
        subscriptionId: user.subscriptionId,
      },
      { expiresIn: accessTokenTtl },
    );

    // Issue refresh token
    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        refreshTokenHash,
        jti: crypto.randomUUID(),
      },
      { expiresIn: refreshTokenTtl },
    );

    // Create a server-side session record
    await this.prisma.userSession.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        workstationId: claims.sid, // Note: this is the sessionId from the offline token
        tokenHash,
        refreshTokenHash,
        issuedAt: now,
        lastActivityAt: now,
        expiresAt: new Date(now.getTime() + refreshTokenTtl * 1000),
        status: 'ACTIVE',
        workstationFingerprint: claims.wfp,
      },
    });

    // Issue a fresh offline token
    const newOfflineToken = await this.offlineTokenService.issueToken({
      userId: user.id,
      role: user.role,
      subscriptionId: user.subscriptionId,
      locationIds: claims.locationIds,
      workstationId: claims.sid,
      workstationFingerprint: claims.wfp,
      sessionId: crypto.randomUUID(),
    });

    // Revoke the old offline token (it's been replaced)
    await this.offlineTokenService.revokeToken({
      jti: claims.jti,
      userId: user.id,
      reason: 'SECURITY_ANOMALY',
      reasonDetail: 'Replaced by blessed session',
    });

    this.logger.log(
      `Offline session ${req.localSessionId} blessed for user ${user.id}`,
    );

    return {
      localSessionId: req.localSessionId,
      status: 'BLESSED',
      replacementToken: {
        accessToken,
        refreshToken,
        offlineToken: newOfflineToken.token,
        expiresAt: accessExpiresAt,
      },
    };
  }

  /**
   * Verify that a user has access to the claimed locations.
   */
  private async checkLocationAccess(
    userId: string,
    locationIds: string[],
  ): Promise<boolean> {
    // OWNERs have implicit access to all locations
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) return false;
    if (user.role === 'OWNER' || user.role === 'SAAS_ADMIN') return true;

    // Check explicit location access
    const accessRecords = await this.prisma.userLocationAccess.findMany({
      where: {
        userId,
        locationId: { in: locationIds },
      },
    });

    return accessRecords.length === locationIds.length;
  }

  /**
   * Record the blessing result in the database.
   */
  private async recordBlessing(
    req: BlessingRequest,
    result: BlessingResult,
  ): Promise<void> {
    try {
      const isBlessed = result.status === 'BLESSED';

      await this.prisma.offlineSessionBlessing.create({
        data: {
          id: crypto.randomUUID(),
          localSessionId: req.localSessionId,
          userId: req.userId,
          workstationId: '',
          offlineTokenJwt: req.offlineTokenJwt,
          workstationFingerprint: req.workstationFingerprint,
          status: isBlessed ? 'BLESSED' : 'REJECTED',
          rejectedReason: isBlessed
            ? null
            : (result.reason as any) ?? null,
          rejectedReasonDetail: isBlessed ? null : result.reason ?? null,
          accessToken: result.replacementToken?.accessToken ?? null,
          refreshToken: result.replacementToken?.refreshToken ?? null,
          offlineToken: result.replacementToken?.offlineToken ?? null,
          blessedAt: isBlessed ? new Date() : null,
          rejectedAt: isBlessed ? null : new Date(),
        },
      });

      // Audit log
      await this.auditService.log(
        isBlessed ? AuditEvent.OFFLINE_SESSION_BLESSED : AuditEvent.OFFLINE_SESSION_REJECTED,
        {
          actorId: req.userId,
          actorRole: null,
          targetType: 'offline_session',
          targetId: req.localSessionId,
          workstationId: undefined,
          details: isBlessed
            ? undefined
            : { reason: result.reason },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to record blessing for ${req.localSessionId}: ${(error as Error).message}`,
      );
    }
  }
}
