import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  SessionRevocationReason,
  SessionStatus,
  UserSession as UserSessionModel,
} from '@pharmacy/database';
import * as crypto from 'node:crypto';

export interface CreateSessionParams {
  userId: string;
  workstationId: string;
  tokenHash: string;
  refreshTokenHash: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
  workstationFingerprint?: string;
  deviceInfo?: string;
  geoCountry?: string;
  geoCity?: string;
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    params: CreateSessionParams,
  ): Promise<UserSessionModel> {
    return this.prisma.userSession.create({
      data: {
        id: crypto.randomUUID(),
        userId: params.userId,
        workstationId: params.workstationId,
        tokenHash: params.tokenHash,
        refreshTokenHash: params.refreshTokenHash,
        issuedAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: params.expiresAt,
        status: SessionStatus.ACTIVE,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        workstationFingerprint: params.workstationFingerprint ?? null,
        deviceInfo: params.deviceInfo ?? null,
        geoCountry: params.geoCountry ?? null,
        geoCity: params.geoCity ?? null,
      },
    });
  }

  async findActiveSessionByTokenHash(
    tokenHash: string,
  ): Promise<UserSessionModel | null> {
    const now = new Date();

    return this.prisma.userSession.findFirst({
      where: {
        tokenHash,
        status: SessionStatus.ACTIVE,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  }

  async findActiveSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<UserSessionModel | null> {
    const now = new Date();

    return this.prisma.userSession.findFirst({
      where: {
        refreshTokenHash,
        status: SessionStatus.ACTIVE,
        revokedAt: null,
        refreshTokenExpiresAt: { gt: now },
      },
    });
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevocationReason = SessionRevocationReason.LOGOUT,
    revokedByUserId?: string,
  ): Promise<UserSessionModel> {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
        revokedByUserId: revokedByUserId ?? null,
      },
    });
  }

  async revokeUserSessions(
    userId: string,
    reason: SessionRevocationReason = SessionRevocationReason.USER_DEACTIVATION,
    revokedByUserId?: string,
    excludeSessionId?: string,
  ): Promise<number> {
    const where: Record<string, unknown> = {
      userId,
      status: SessionStatus.ACTIVE,
      revokedAt: null,
    };
    if (excludeSessionId) {
      where.id = { not: excludeSessionId };
    }

    const result = await this.prisma.userSession.updateMany({
      where,
      data: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
        revokedByUserId: revokedByUserId ?? null,
      },
    });

    return result.count;
  }

  async findSessionById(
    sessionId: string,
  ): Promise<(UserSessionModel & { user: { id: string; displayName: string | null; fullName: string; role: string; avatarUrl: string | null; avatarColor: string | null } }) | null> {
    return this.prisma.userSession.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            fullName: true,
            role: true,
            avatarUrl: true,
            avatarColor: true,
          },
        },
      },
    });
  }

  async findActiveSessionsByUser(userId: string): Promise<UserSessionModel[]> {
    const now = new Date();

    return this.prisma.userSession.findMany({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  async findActiveSessionsByWorkstation(
    workstationId: string,
  ): Promise<(UserSessionModel & { user: { id: string; displayName: string | null; fullName: string; role: string; avatarUrl: string | null; avatarColor: string | null } })[]> {
    const now = new Date();

    return this.prisma.userSession.findMany({
      where: {
        workstationId,
        status: SessionStatus.ACTIVE,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            fullName: true,
            role: true,
            avatarUrl: true,
            avatarColor: true,
          },
        },
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  async touchLastActivity(sessionId: string): Promise<UserSessionModel> {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        lastActivityAt: new Date(),
      },
    });
  }

  /**
   * Update token hashes and expiry after a token rotation.
   * Invalidates the previous access/refresh tokens.
   */
  async updateSessionTokens(
    sessionId: string,
    tokenHash: string,
    refreshTokenHash: string,
    expiresAt?: Date,
  ): Promise<UserSessionModel> {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        tokenHash,
        refreshTokenHash,
        lastActivityAt: new Date(),
        ...(expiresAt ? { expiresAt } : {}),
      },
    });
  }

  /**
   * Enforce the session limit per user.
   * If the user has more active sessions than allowed, evict the oldest.
   */
  async enforceSessionLimit(
    userId: string,
    maxSessions: number,
    newSessionId?: string,
  ): Promise<{ evicted: boolean; evictedSessionId?: string }> {
    const activeSessions = await this.findActiveSessionsByUser(userId);

    if (activeSessions.length < maxSessions) {
      return { evicted: false };
    }

    // Exclude the new session if provided
    const sessionsToConsider = newSessionId
      ? activeSessions.filter((s) => s.id !== newSessionId)
      : activeSessions;

    if (sessionsToConsider.length < maxSessions) {
      return { evicted: false };
    }

    // Evict the oldest session
    const sorted = [...sessionsToConsider].sort(
      (a, b) =>
        new Date(a.lastActivityAt).getTime() -
        new Date(b.lastActivityAt).getTime(),
    );

    const toEvict = sorted[0];
    await this.revokeSession(toEvict.id, SessionRevocationReason.NEW_LOGIN_EVICT);

    return { evicted: true, evictedSessionId: toEvict.id };
  }
}
