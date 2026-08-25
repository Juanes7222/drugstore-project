/**
 * SaaS-admin per-customer service — every read here takes an explicit
 * subscription id (the platform admin is attached to none), and any query
 * touching an RLS-enforced table (Sale, CashShift, FiscalDocument) runs
 * inside that subscription's scoped transaction via PrismaService.withTenant.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  Prisma,
  SaleOperationalState,
  ShiftState,
  UserStatus,
} from '@pharmacy/database';
import type {
  SalesOverviewQuery,
  SalesOverviewResult,
} from '@/modules/backoffice/services/sales-overview.service';
import { SalesOverviewService } from '@/modules/backoffice/services/sales-overview.service';
import type { SessionsOverviewResult } from '@/modules/backoffice/services/session-overview.service';
import { SessionOverviewService } from '@/modules/backoffice/services/session-overview.service';
import type { WorkstationOverviewResult } from '@/modules/backoffice/services/workstation-overview.service';
import { WorkstationOverviewService } from '@/modules/backoffice/services/workstation-overview.service';
import type { FiscalStatusResult } from '@/modules/backoffice/services/fiscal-status.service';
import { FiscalStatusService } from '@/modules/backoffice/services/fiscal-status.service';
import { SaasAdminAccessAuditService } from './saas-admin-access-audit.service';

/** Mirrors UsersController.listUsers' projection so both user listings stay identical. */
const USER_LIST_SELECT = {
  id: true,
  displayName: true,
  fullName: true,
  email: true,
  username: true,
  role: true,
  status: true,
  isActive: true,
  avatarUrl: true,
  avatarColor: true,
  authMethod: true,
  totpEnabled: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  createdById: true,
  deletedAt: true,
} as const;

// Same fiscal-state classification as DashboardService.summarizeFiscal.
const FISCAL_PENDING_STATES = new Set([
  'PENDING_GENERATION',
  'PENDING_SIGNATURE',
  'PENDING_TRANSMISSION',
  'IN_TRANSMISSION',
  'PENDING_RESPONSE',
]);

export interface SaasAdminCustomerDashboard {
  salesToday: { count: number; totalAmount: string };
  sales30d: { count: number; totalAmount: string; previousTotal: string };
  cashShifts: { openCount: number; differenceAmount30d: string };
  users: { pendingApproval: number };
  fiscal: { pending: number; rejected: number };
}

export interface SaasAdminUsersResult {
  users: Prisma.UserGetPayload<{ select: typeof USER_LIST_SELECT }>[];
  total: number;
}

type TenantTx = Prisma.TransactionClient;

@Injectable()
export class SaasAdminCustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesOverview: SalesOverviewService,
    private readonly sessionOverview: SessionOverviewService,
    private readonly workstationOverview: WorkstationOverviewService,
    private readonly fiscalStatus: FiscalStatusService,
    private readonly accessAudit: SaasAdminAccessAuditService,
  ) {}

  /**
   * Per-tenant KPI card. One RLS-scoped transaction covers every query
   * (Sale, CashShift and FiscalDocument are all tenant-isolated rows).
   */
  async getDashboard(
    actor: { id: string; role: string },
    subscriptionId: string,
  ): Promise<SaasAdminCustomerDashboard> {
    const dashboard = await this.prisma.withTenant(
      subscriptionId,
      async (tx) => this.collectDashboard(tx, subscriptionId),
    );
    await this.recordAccess(actor, subscriptionId, 'dashboard');
    return dashboard;
  }

  /**
   * Tenant user directory, same response shape as GET /users.
   * User carries no RLS policy, so it reads on the root client.
   */
  async listUsers(
    actor: { id: string; role: string },
    subscriptionId: string,
  ): Promise<SaasAdminUsersResult> {
    const where = { subscriptionId, deletedAt: null };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    await this.recordAccess(actor, subscriptionId, 'users');
    return { users, total };
  }

  /** Reuses SalesOverviewService's listing/summary pipeline verbatim. */
  async getSales(
    actor: { id: string; role: string },
    subscriptionId: string,
    query: SalesOverviewQuery,
  ): Promise<SalesOverviewResult> {
    const result = await this.prisma.withTenant(subscriptionId, () =>
      this.salesOverview.getSalesForSubscription(subscriptionId, query),
    );
    await this.recordAccess(actor, subscriptionId, 'sales');
    return result;
  }

  /** Same shape as GET /backoffice/sessions, scoped to the tenant's users. */
  async getSessions(
    actor: { id: string; role: string },
    subscriptionId: string,
    query: { page?: number; pageSize?: number },
  ): Promise<SessionsOverviewResult> {
    const userIds = await this.tenantUserIds(subscriptionId);
    const result = await this.sessionOverview.getActiveSessionsForUsers(
      userIds,
      query,
    );
    await this.recordAccess(actor, subscriptionId, 'sessions');
    return result;
  }

  /** Same shape as GET /backoffice/workstations, scoped to the tenant. */
  async getWorkstations(
    actor: { id: string; role: string },
    subscriptionId: string,
  ): Promise<WorkstationOverviewResult> {
    const userIds = await this.tenantUserIds(subscriptionId);
    // The sales-today groupBy inside reaches Sale through CashShift, hence
    // the scoped transaction even though sessions themselves are not RLS'd.
    const result = await this.prisma.withTenant(subscriptionId, () =>
      this.workstationOverview.getWorkstationsForTenant({
        subscriptionId,
        userIds,
      }),
    );
    await this.recordAccess(actor, subscriptionId, 'workstations');
    return result;
  }

  /** Same shape as GET /backoffice/fiscal-status, scoped to the tenant. */
  async getFiscalStatus(
    actor: { id: string; role: string },
    subscriptionId: string,
    from?: string,
  ): Promise<FiscalStatusResult> {
    const result = await this.prisma.withTenant(subscriptionId, () =>
      this.fiscalStatus.getStatusForSubscription(subscriptionId, from),
    );
    await this.recordAccess(actor, subscriptionId, 'fiscal-status');
    return result;
  }

  private async tenantUserIds(subscriptionId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { subscriptionId },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async collectDashboard(
    tx: TenantTx,
    subscriptionId: string,
  ): Promise<SaasAdminCustomerDashboard> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const currentFrom = new Date(dayStart.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousFrom = new Date(
      dayStart.getTime() - 60 * 24 * 60 * 60 * 1000,
    );

    const [
      salesToday,
      sales30d,
      previousSales30d,
      openShifts,
      shiftDifferences,
      pendingUsers,
      fiscalByState,
    ] = await Promise.all([
      tx.sale.aggregate({
        where: {
          cashShift: { subscriptionId },
          confirmedAt: { gte: dayStart },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      tx.sale.aggregate({
        where: {
          cashShift: { subscriptionId },
          confirmedAt: { gte: currentFrom },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      tx.sale.aggregate({
        where: {
          cashShift: { subscriptionId },
          confirmedAt: { gte: previousFrom, lt: currentFrom },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      tx.cashShift.count({
        where: { subscriptionId, state: ShiftState.OPEN },
      }),
      tx.cashShift.aggregate({
        where: {
          subscriptionId,
          closedAt: { gte: currentFrom },
          closingDifference: { not: 0 },
        },
        _sum: { closingDifference: true },
      }),
      tx.user.count({
        where: { subscriptionId, status: UserStatus.PENDING_SETUP },
      }),
      tx.fiscalDocument.groupBy({
        by: ['fiscalState'],
        where: { subscriptionId },
        _count: { _all: true },
      }),
    ]);

    let fiscalPending = 0;
    let fiscalRejected = 0;
    for (const row of fiscalByState) {
      if (row.fiscalState === 'REJECTED') {
        fiscalRejected += row._count._all;
      } else if (FISCAL_PENDING_STATES.has(row.fiscalState)) {
        fiscalPending += row._count._all;
      }
    }

    return {
      salesToday: {
        count: salesToday._count.id,
        totalAmount:
          salesToday._sum.totalAmount?.toString() ?? '0',
      },
      sales30d: {
        count: sales30d._count.id,
        totalAmount: sales30d._sum.totalAmount?.toString() ?? '0',
        previousTotal: previousSales30d._sum.totalAmount?.toString() ?? '0',
      },
      cashShifts: {
        openCount: openShifts,
        differenceAmount30d:
          shiftDifferences._sum.closingDifference?.toString() ?? '0',
      },
      users: { pendingApproval: pendingUsers },
      fiscal: { pending: fiscalPending, rejected: fiscalRejected },
    };
  }

  /**
   * Cross-tenant reads are recorded in the immutable audit log so a
   * platform admin's visibility into customer data is always traceable.
   */
  private recordAccess(
    actor: { id: string; role: string },
    subscriptionId: string,
    endpoint: string,
  ): Promise<void> {
    return this.accessAudit.recordCustomerAccess({
      actorUser: actor,
      subscriptionId,
      endpoint: `/saas-admin/customers/${subscriptionId}/${endpoint}`,
    });
  }
}
