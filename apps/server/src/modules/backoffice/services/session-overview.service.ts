/**
 * Backoffice session overview — active sessions across the tenant with
 * user and workstation context. Read-only; revocation stays in auth.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SessionStatus } from '@pharmacy/database';
import { BackofficeScopeService } from './backoffice-scope.service';

export interface SessionsOverviewQuery {
  page?: number;
  pageSize?: number;
}

export interface SessionsOverviewResult {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class SessionOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getActiveSessions(
    user: User,
    query: SessionsOverviewQuery,
  ): Promise<SessionsOverviewResult> {
    const userWhere = await this.scope.userTenantWhere(user);
    const where: Record<string, unknown> = {
      status: SessionStatus.ACTIVE,
      ...userWhere,
    };

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [data, total] = await Promise.all([
      this.prisma.userSession.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          workstationId: true,
          ipAddress: true,
          userAgent: true,
          geoCountry: true,
          geoCity: true,
          deviceInfo: true,
          issuedAt: true,
          lastActivityAt: true,
          expiresAt: true,
          user: {
            select: {
              displayName: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
          workstation: { select: { name: true, code: true } },
        },
      }),
      this.prisma.userSession.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
