import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SessionRevocationReason } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class SessionService {
  constructor(private prisma: PrismaService) {}

  async createSession(params: {
    userId: string;
    workstationId: string;
    tokenHash: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<any> {
    return this.prisma.userSession.create({
      data: {
        id: this.generateId(),
        userId: params.userId,
        workstationId: params.workstationId,
        tokenHash: params.tokenHash,
        refreshTokenHash: params.refreshTokenHash,
        issuedAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: params.expiresAt,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
      },
    });
  }

  async findActiveSessionByTokenHash(tokenHash: string): Promise<any> {
    const now = new Date();

    return this.prisma.userSession.findUnique({
      where: { tokenHash },
    }).then((session: any) => {
      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt <= now
      ) {
        return null;
      }
      return session;
    });
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Promise<any> {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
  }

  async touchLastActivity(sessionId: string): Promise<any> {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        lastActivityAt: new Date(),
      },
    });
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
