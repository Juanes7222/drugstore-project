/**
 * Backoffice workstation overview — terminal state (last seen, active
 * sessions, sales today). SAAS_ADMIN sees every workstation; other roles
 * see only workstations their tenant's users have sessions on.
 */

import { Injectable } from '@nestjs/common';
import { RoleType, User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SessionStatus, SaleOperationalState } from '@pharmacy/database';
import { BackofficeScopeService } from './backoffice-scope.service';

export interface WorkstationOverviewResult {
  workstations: unknown[];
  activeSessionCount: number;
}

@Injectable()
export class WorkstationOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getWorkstations(user: User): Promise<WorkstationOverviewResult> {
    const saleScope = this.scope.saleTenantWhere(user);

    let workstationFilter: Record<string, unknown> = {};
    if (user.role !== RoleType.SAAS_ADMIN) {
      const userIds = await this.scope.tenantUserIds(user);
      if (userIds === null) {
        workstationFilter = {};
      } else {
        const tenantSessions = await this.prisma.userSession.findMany({
          where: { userId: { in: userIds }, status: SessionStatus.ACTIVE },
          select: { workstationId: true },
          distinct: ['workstationId'],
        });
        workstationFilter = {
          id: { in: tenantSessions.map((s) => s.workstationId) },
        };
      }
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [
      workstations,
      activeSessionsByWs,
      salesTodayByWs,
      activeSessionCount,
    ] = await Promise.all([
      this.prisma.workstation.findMany({
        where: workstationFilter,
        orderBy: { lastSeenAt: 'desc' },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          registeredAt: true,
          lastSeenAt: true,
        },
      }),
      this.prisma.userSession.groupBy({
        by: ['workstationId'],
        where: { status: SessionStatus.ACTIVE },
        _count: { _all: true },
      }),
      this.prisma.sale.groupBy({
        by: ['workstationId'],
        where: {
          ...saleScope,
          confirmedAt: { gte: dayStart },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        _count: { _all: true },
      }),
      this.prisma.userSession.count({
        where: { status: SessionStatus.ACTIVE },
      }),
    ]);

    const sessionsByWs = new Map(
      activeSessionsByWs.map((g) => [g.workstationId, g._count._all]),
    );
    const salesByWs = new Map(
      salesTodayByWs.map((g) => [g.workstationId, g._count._all]),
    );

    const enriched = workstations.map((ws) => ({
      ...ws,
      activeSessions: sessionsByWs.get(ws.id) ?? 0,
      salesToday: salesByWs.get(ws.id) ?? 0,
    }));

    return { workstations: enriched, activeSessionCount };
  }
}
