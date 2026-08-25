/**
 * Backoffice workstation overview — terminal state (last seen, active
 * sessions, sales today) for the caller's tenant. Platform admins use the
 * saas-admin module's explicit-subscription variant instead.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SessionStatus, SaleOperationalState } from '@pharmacy/database';
import { BackofficeScopeService } from './backoffice-scope.service';

export interface WorkstationOverviewResult {
  workstations: unknown[];
  activeSessionCount: number;
}

interface TenantWorkstationScope {
  workstationFilter: Record<string, unknown>;
  saleScope: Record<string, unknown>;
  sessionCountWhere: Record<string, unknown>;
}

@Injectable()
export class WorkstationOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getWorkstations(user: User): Promise<WorkstationOverviewResult> {
    const userIds = await this.scope.tenantUserIds(user);
    const tenantSessions = userIds.length
      ? await this.prisma.userSession.findMany({
          where: { userId: { in: userIds }, status: SessionStatus.ACTIVE },
          select: { workstationId: true },
          distinct: ['workstationId'],
        })
      : [];
    return this.collect({
      workstationFilter: {
        id: { in: tenantSessions.map((s) => s.workstationId) },
      },
      // Sale is reached through CashShift because the shared schema declares
      // no direct subscriptionId on it.
      saleScope: { cashShift: { subscriptionId: this.requireCallerSubscription(user) } },
      // Preserved historical behavior of GET /backoffice/workstations: the
      // headline counter spans every active session, not just the tenant's.
      sessionCountWhere: {},
    });
  }

  /**
   * Explicit-subscription variant used by the saas-admin module: same
   * response shape, scoped to the given subscription's users.
   */
  async getWorkstationsForTenant(params: {
    subscriptionId: string;
    userIds: string[];
  }): Promise<WorkstationOverviewResult> {
    const tenantSessions = params.userIds.length
      ? await this.prisma.userSession.findMany({
          where: { userId: { in: params.userIds }, status: SessionStatus.ACTIVE },
          select: { workstationId: true },
          distinct: ['workstationId'],
        })
      : [];
    return this.collect({
      workstationFilter: {
        id: { in: tenantSessions.map((s) => s.workstationId) },
      },
      saleScope: { cashShift: { subscriptionId: params.subscriptionId } },
      sessionCountWhere: { userId: { in: params.userIds } },
    });
  }

  private requireCallerSubscription(user: User): string {
    if (!user.subscriptionId) {
      // Unreachable through the backoffice controllers (BackofficeScopeService
      // already rejects), but keeps the type honest for direct callers.
      throw new Error('User is not attached to a subscription');
    }
    return user.subscriptionId;
  }

  private async collect(
    scope: TenantWorkstationScope,
  ): Promise<WorkstationOverviewResult> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [
      workstations,
      activeSessionsByWs,
      salesTodayByWs,
      activeSessionCount,
    ] = await Promise.all([
      this.prisma.workstation.findMany({
        where: scope.workstationFilter,
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
          ...scope.saleScope,
          confirmedAt: { gte: dayStart },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        _count: { _all: true },
      }),
      this.prisma.userSession.count({
        where: { status: SessionStatus.ACTIVE, ...scope.sessionCountWhere },
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
