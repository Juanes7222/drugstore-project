/**
 * SaaS-admin platform overview — cross-tenant KPIs and the paginated
 * customer subscription listing for the platform operator's console.
 * Every monetary value is a decimal string; every read is scoped by an
 * explicitly provided subscription id, never by role-derived filters.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  FraudAlertStatus,
  Prisma,
  SessionStatus,
  SubscriptionStatus,
} from '@pharmacy/database';
import { SubscriptionNotFoundException } from '../exceptions/subscription-not-found.exception';

export interface PlatformCustomersSummary {
  total: number;
  active: number;
  trial: number;
  pastDue: number;
  canceled: number;
  suspended: number;
}

export interface PlatformOverviewResult {
  customers: PlatformCustomersSummary;
  sales30d: { count: number; totalAmount: string };
  activeSessions: number;
  workstationCount: number;
  openFraudAlerts: number;
}

/** One row of GET /saas-admin/customers; mirrors the backoffice
 *  subscriptions overview shape plus lastActivityAt. */
export interface SaasAdminCustomerRow {
  id: string;
  customerName: string;
  customerTaxId: string;
  customerEmail: string | null;
  status: string;
  plan: { code: string; name: string };
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  _count: {
    locations: number;
    workstationActivations: number;
    fraudAlerts: number;
  };
  lastActivityAt: string | null;
}

export interface SaasAdminCustomersResult {
  data: SaasAdminCustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CustomersQuery {
  page?: number;
  pageSize?: number;
  query?: string;
}

type SubscriptionTx = Prisma.TransactionClient;

const CUSTOMER_ROW_SELECT = {
  id: true,
  customerName: true,
  customerTaxId: true,
  customerEmail: true,
  status: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  trialEndsAt: true,
  cancelAtPeriodEnd: true,
  plan: { select: { code: true, name: true } },
  _count: {
    select: {
      locations: true,
      workstationActivations: true,
      fraudAlerts: true,
    },
  },
} as const;

/** How many tenants are aggregated concurrently inside RLS-scoped transactions. */
const TENANT_AGGREGATION_CONCURRENCY = 10;

@Injectable()
export class SaasAdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getPlatformOverview(): Promise<PlatformOverviewResult> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(
      dayStart.getTime() - 30 * 24 * 60 * 60 * 1000,
    );

    const [statusGroups, activeSessions, workstationCount, openFraudAlerts, subscriptions] =
      await Promise.all([
        this.prisma.subscription.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.userSession.count({
          where: { status: SessionStatus.ACTIVE },
        }),
        this.prisma.workstation.count(),
        this.prisma.fraudAlert.count({
          where: { status: FraudAlertStatus.OPEN },
        }),
        this.prisma.subscription.findMany({ select: { id: true } }),
      ]);

    // Sale enforces FORCE ROW LEVEL SECURITY, so the platform-wide 30-day
    // total must be aggregated once per tenant inside an RLS-scoped
    // transaction; one unscoped aggregate would fail closed to zero rows.
    const partials = await this.aggregateAcrossTenants(
      subscriptions.map((s) => s.id),
      async (tx, subscriptionId) => {
        const aggregate = await tx.sale.aggregate({
          where: {
            cashShift: { subscriptionId },
            confirmedAt: { gte: thirtyDaysAgo },
            operationalState: 'CONFIRMED',
          },
          _count: { id: true },
          _sum: { totalAmount: true },
        });
        return {
          count: aggregate._count.id,
          totalAmount: aggregate._sum.totalAmount ?? new Prisma.Decimal(0),
        };
      },
    );

    let totalCount = 0;
    let totalAmount = new Prisma.Decimal(0);
    for (const partial of partials) {
      totalCount += partial.count;
      totalAmount = totalAmount.plus(partial.totalAmount);
    }

    return {
      customers: this.summarizeSubscriptionStatuses(statusGroups),
      sales30d: { count: totalCount, totalAmount: totalAmount.toString() },
      activeSessions,
      workstationCount,
      openFraudAlerts,
    };
  }

  async getCustomers(query: CustomersQuery): Promise<SaasAdminCustomersResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;
    const where = this.buildCustomerFilter(query.query);

    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: { ...CUSTOMER_ROW_SELECT },
      }),
      this.prisma.subscription.count({ where }),
    ]);
    const rows = await this.toCustomerRows(subscriptions);

    return {
      data: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getCustomer(subscriptionId: string): Promise<SaasAdminCustomerRow> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { ...CUSTOMER_ROW_SELECT },
    });
    if (!subscription) {
      throw new SubscriptionNotFoundException(subscriptionId);
    }
    const [row] = await this.toCustomerRows([subscription]);
    return row;
  }

  private buildCustomerFilter(query?: string): Record<string, unknown> | undefined {
    if (!query) {
      return undefined;
    }
    const needle = { contains: query };
    return {
      OR: [
        { customerName: needle },
        { customerEmail: needle },
        { customerTaxId: needle },
      ],
    };
  }

  /**
   * Map subscription rows to API rows, resolving lastActivityAt per
   * subscription: the most recent session activity of any of its users,
   * falling back to its latest confirmed sale. Sessions live outside RLS
   * so they aggregate in one grouped query; the sale fallback needs
   * per-tenant RLS-scoped transactions.
   */
  private async toCustomerRows(
    subscriptions: (Prisma.SubscriptionGetPayload<{
      select: typeof CUSTOMER_ROW_SELECT;
    }>)[],
  ): Promise<SaasAdminCustomerRow[]> {
    if (subscriptions.length === 0) {
      return [];
    }
    const subscriptionIds = subscriptions.map((s) => s.id);
    const lastActivityAt = await this.loadLastActivityAt(subscriptionIds);
    return subscriptions.map((subscription) => ({
      id: subscription.id,
      customerName: subscription.customerName,
      customerTaxId: subscription.customerTaxId,
      customerEmail: subscription.customerEmail,
      status: subscription.status,
      plan: subscription.plan,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      _count: subscription._count,
      lastActivityAt: lastActivityAt.get(subscription.id)?.toISOString() ?? null,
    }));
  }

  private async loadLastActivityAt(
    subscriptionIds: string[],
  ): Promise<Map<string, Date>> {
    if (subscriptionIds.length === 0) {
      return new Map();
    }

    const tenantUsers = await this.prisma.user.findMany({
      where: { subscriptionId: { in: subscriptionIds } },
      select: { id: true, subscriptionId: true },
    });
    const subscriptionByUserId = new Map(
      tenantUsers.map((user) => [user.id, user.subscriptionId]),
    );

    const latest = new Map<string, Date>();
    const keepLatest = (subscriptionId: string, candidate: Date): void => {
      const existing = latest.get(subscriptionId);
      if (!existing || candidate > existing) {
        latest.set(subscriptionId, candidate);
      }
    };

    if (tenantUsers.length > 0) {
      const sessionMaxima = await this.prisma.userSession.groupBy({
        by: ['userId'],
        where: { userId: { in: tenantUsers.map((u) => u.id) } },
        _max: { lastActivityAt: true },
      });
      for (const row of sessionMaxima) {
        const subscriptionId = subscriptionByUserId.get(row.userId);
        const lastActivity = row._max.lastActivityAt;
        if (subscriptionId && lastActivity) {
          keepLatest(subscriptionId, lastActivity);
        }
      }
    }

    // Subscriptions without session activity fall back to their latest
    // confirmed sale; aggregateAcrossTenants preserves input order.
    const missing = subscriptionIds.filter((id) => !latest.has(id));
    if (missing.length > 0) {
      const saleMaxima = await this.aggregateAcrossTenants(
        missing,
        async (tx, subscriptionId) => {
          const latestSale = await tx.sale.findFirst({
            where: { cashShift: { subscriptionId }, confirmedAt: { not: null } },
            orderBy: { confirmedAt: 'desc' },
            select: { confirmedAt: true },
          });
          return latestSale?.confirmedAt ?? null;
        },
      );
      for (let i = 0; i < missing.length; i += 1) {
        const confirmedAt = saleMaxima[i];
        if (confirmedAt) {
          keepLatest(missing[i], confirmedAt);
        }
      }
    }

    return latest;
  }

  /**
   * Run a per-tenant read inside an RLS-scoped transaction for each
   * subscription id, bounded concurrency, results in input order.
   */
  private async aggregateAcrossTenants<T>(
    subscriptionIds: string[],
    fn: (tx: SubscriptionTx, subscriptionId: string) => Promise<T>,
  ): Promise<T[]> {
    const results = new Array<T>(subscriptionIds.length);
    for (
      let start = 0;
      start < subscriptionIds.length;
      start += TENANT_AGGREGATION_CONCURRENCY
    ) {
      const batch = subscriptionIds.slice(
        start,
        start + TENANT_AGGREGATION_CONCURRENCY,
      );
      const settled = await Promise.all(
        batch.map((subscriptionId) =>
          this.prisma.withTenant(subscriptionId, (tx) => fn(tx, subscriptionId)),
        ),
      );
      for (let i = 0; i < batch.length; i += 1) {
        results[start + i] = settled[i];
      }
    }
    return results;
  }

  private summarizeSubscriptionStatuses(
    groups: { status: string; _count: { _all: number } }[],
  ): PlatformCustomersSummary {
    const summary: PlatformCustomersSummary = {
      total: 0,
      active: 0,
      trial: 0,
      pastDue: 0,
      canceled: 0,
      suspended: 0,
    };
    for (const group of groups) {
      summary.total += group._count._all;
      switch (group.status) {
        case SubscriptionStatus.ACTIVE:
          summary.active += group._count._all;
          break;
        case SubscriptionStatus.TRIAL:
          summary.trial += group._count._all;
          break;
        case SubscriptionStatus.PAST_DUE:
          summary.pastDue += group._count._all;
          break;
        case SubscriptionStatus.CANCELLED:
          summary.canceled += group._count._all;
          break;
        case SubscriptionStatus.SUSPENDED:
          summary.suspended += group._count._all;
          break;
        default:
          break;
      }
    }
    return summary;
  }
}
