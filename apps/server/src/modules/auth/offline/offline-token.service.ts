/**
 * Offline JWT token service — issue, verify, and revoke.
 *
 * Offline tokens are long-lived JWTs (default 30 days for cashiers, 14 days
 * for managers/owners) signed with the same secret as access tokens (HS256).
 * They carry a workstation fingerprint claim (`wfp`) so they are bound to a
 * specific device. The POS client can verify the token locally without
 * contacting the server.
 *
 * The revocation list is persisted in the database and polled by clients.
 * Urgent revocations (stolen workstation) are pushed via the sync response.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { EnvConfig } from '@/config/env.schema';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OfflineTokenClaims {
  sub: string;                          // userId
  sid: string;                          // sessionId
  role: string;
  subscriptionId: string | null;
  locationIds: string[];
  wfp: string;                          // workstation fingerprint
  typ: 'offline';                       // token type discriminator
  jti: string;                          // unique token ID (for revocation)
  iat: number;
  exp: number;
}

export interface OfflineTokenResult {
  token: string;
  expiresAt: Date;
  jti: string;
}

export interface RevocationListEntry {
  jti: string;
  revokedAt: Date;
  reason: string;
}

// ---------------------------------------------------------------------------
// Default TTLs per role
// ---------------------------------------------------------------------------

const CASHIER_OFFLINE_TTL_DAYS = 30;
const MANAGER_OFFLINE_TTL_DAYS = 14;
const OWNER_OFFLINE_TTL_DAYS = 14;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class OfflineTokenService {
  private readonly logger = new Logger(OfflineTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig>,
  ) {}

  /**
   * Issue an offline JWT for the given user and workstation.
   * The TTL is determined by the user's role, overridable by the
   * subscription's `offlineGracePeriodDays`.
   */
  async issueToken(params: {
    userId: string;
    role: string;
    subscriptionId: string | null;
    locationIds: string[];
    workstationId: string;
    workstationFingerprint: string;
    sessionId: string;
  }): Promise<OfflineTokenResult> {
    const ttlDays = await this.resolveTtlDays(params.role, params.subscriptionId);
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlDays * 86400;

    const payload = {
      sub: params.userId,
      sid: params.sessionId,
      role: params.role,
      subscriptionId: params.subscriptionId,
      locationIds: params.locationIds,
      wfp: params.workstationFingerprint,
      typ: 'offline' as const,
      jti,
      iat: now,
    };

    const token = this.jwtService.sign(payload, {
      expiresIn: `${ttlDays}d`,
    });

    this.logger.debug(
      `Offline token issued for user ${params.userId} (${params.role}), expires in ${ttlDays}d`,
    );

    return {
      token,
      expiresAt: new Date(exp * 1000),
      jti,
    };
  }

  /**
   * Verify an offline token's signature, type, and expiration.
   * Returns the decoded claims if valid, `null` otherwise.
   * Does NOT check the revocation list — call `isRevoked` separately.
   */
  verifyToken(token: string): OfflineTokenClaims | null {
    try {
      const decoded = this.jwtService.verify<OfflineTokenClaims>(token);

      // Verify token type
      if (decoded.typ !== 'offline') {
        return null;
      }

      // Verify required claims exist
      if (!decoded.sub || !decoded.wfp || !decoded.jti) {
        return null;
      }

      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Decode an offline token without verifying signature.
   * Use only for reading claims before blessing (the blessing flow
   * validates the signature separately).
   */
  decodeToken(token: string): OfflineTokenClaims | null {
    try {
      const decoded = this.jwtService.decode(token) as OfflineTokenClaims | null;
      if (!decoded || decoded.typ !== 'offline') {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Revoke an offline token by adding its `jti` to the revocation list.
   */
  async revokeToken(params: {
    jti: string;
    userId?: string;
    workstationId?: string;
    reason: 'USER_DISABLED' | 'USER_LOCKED' | 'PASSWORD_CHANGED' | 'PIN_CHANGED' | 'WORKSTATION_REVOKED' | 'ADMIN_REVOCATION' | 'FRAUD_DETECTED' | 'SECURITY_ANOMALY';
    reasonDetail?: string;
  }): Promise<void> {
    // Check if already revoked
    const existing = await this.prisma.offlineTokenRevocation.findUnique({
      where: { jti: params.jti },
    });

    if (existing) {
      return; // Idempotent
    }

    await this.prisma.offlineTokenRevocation.create({
      data: {
        id: crypto.randomUUID(),
        jti: params.jti,
        userId: params.userId ?? null,
        workstationId: params.workstationId ?? null,
        reason: params.reason,
        reasonDetail: params.reasonDetail ?? null,
        revokedAt: new Date(),
      },
    });

    this.logger.warn(
      `Offline token ${params.jti.substring(0, 8)}... revoked (reason: ${params.reason})`,
    );
  }

  /**
   * Check if a token's `jti` is in the revocation list.
   */
  async isRevoked(jti: string): Promise<boolean> {
    const entry = await this.prisma.offlineTokenRevocation.findUnique({
      where: { jti },
    });
    return entry !== null;
  }

  /**
   * Revoke all offline tokens for a user (e.g., when user is disabled).
   */
  async revokeAllUserTokens(
    userId: string,
    reason: 'USER_DISABLED' | 'USER_LOCKED' | 'PASSWORD_CHANGED' | 'PIN_CHANGED' | 'SECURITY_ANOMALY',
  ): Promise<number> {
    // We don't store issued tokens by user in a table, so we add a marker
    // that tells the client to invalidate all cached tokens for this user.
    // The client checks: if any revocation entry exists with this userId
    // and was created after the token was issued, the token is revoked.
    // For simplicity we record a user-level revocation marker.
    const entry = await this.prisma.offlineTokenRevocation.create({
      data: {
        id: crypto.randomUUID(),
        jti: `user:${userId}:${Date.now()}`,
        userId,
        reason,
        revokedAt: new Date(),
      },
    });

    this.logger.warn(
      `All offline tokens revoked for user ${userId} (reason: ${reason})`,
    );

    return 1;
  }

  /**
   * Revoke all offline tokens for a workstation.
   */
  async revokeAllWorkstationTokens(
    workstationId: string,
    reason: 'WORKSTATION_REVOKED' | 'SECURITY_ANOMALY',
  ): Promise<number> {
    const entry = await this.prisma.offlineTokenRevocation.create({
      data: {
        id: crypto.randomUUID(),
        jti: `workstation:${workstationId}:${Date.now()}`,
        workstationId,
        reason,
        revokedAt: new Date(),
      },
    });

    this.logger.warn(
      `All offline tokens revoked for workstation ${workstationId} (reason: ${reason})`,
    );

    return 1;
  }

  /**
   * Get the revocation list delta since a given timestamp.
   */
  async getRevocationListSince(since: Date): Promise<RevocationListEntry[]> {
    const entries = await this.prisma.offlineTokenRevocation.findMany({
      where: {
        revokedAt: { gt: since },
      },
      orderBy: { revokedAt: 'asc' },
    });

    return entries.map((e) => ({
      jti: e.jti,
      revokedAt: e.revokedAt,
      reason: e.reason,
    }));
  }

  /**
   * Get the full revocation list (paginated).
   */
  async getRevocationList(params: {
    limit?: number;
    offset?: number;
  }): Promise<{ entries: RevocationListEntry[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.offlineTokenRevocation.findMany({
        orderBy: { revokedAt: 'desc' },
        take: params.limit ?? 100,
        skip: params.offset ?? 0,
      }),
      this.prisma.offlineTokenRevocation.count(),
    ]);

    return {
      entries: rows.map((e) => ({
        jti: e.jti,
        revokedAt: e.revokedAt,
        reason: e.reason,
      })),
      total,
    };
  }

  /**
   * Check if any user-level revocation exists that is newer than a given timestamp.
   * Used during blessing to validate that the user wasn't revoked after the token was issued.
   */
  async isUserRevokedSince(userId: string, since: Date): Promise<boolean> {
    const entry = await this.prisma.offlineTokenRevocation.findFirst({
      where: {
        userId,
        revokedAt: { gt: since },
      },
    });
    return entry !== null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve the offline token TTL in days based on the user's role and
   * subscription configuration.
   */
  private async resolveTtlDays(
    role: string,
    subscriptionId: string | null,
  ): Promise<number> {
    // Try subscription-level override first
    if (subscriptionId) {
      try {
        const subscription = await this.prisma.subscription.findUnique({
          where: { id: subscriptionId },
          select: { offlineGracePeriodDays: true },
        });

        if (subscription?.offlineGracePeriodDays) {
          return subscription.offlineGracePeriodDays;
        }
      } catch {
        // Fall through to role-based default
      }
    }

    // Role-based defaults
    switch (role) {
      case 'CASHIER':
        return CASHIER_OFFLINE_TTL_DAYS;
      case 'MANAGER':
      case 'OWNER':
        return OWNER_OFFLINE_TTL_DAYS;
      default:
        return CASHIER_OFFLINE_TTL_DAYS;
    }
  }
}
