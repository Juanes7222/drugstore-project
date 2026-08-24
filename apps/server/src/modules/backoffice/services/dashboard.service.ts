/**
 * Backoffice dashboard service — aggregates the daily KPIs shown on the
 * admin panel's first screen: sales, cash shifts, inventory, fiscal,
 * sync, and user state for the caller's tenant.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  Prisma,
  SaleOperationalState,
  ShiftState,
  SessionStatus,
  UserStatus,
} from '@pharmacy/database';
import { BackofficeScopeService } from './backoffice-scope.service';

const EXPIRING_LOT_DAYS = 90;
const SALES_TREND_DAYS = 14;

export interface DashboardResponse {
  period: { from: string; to: string };
  sales: {
    confirmedCount: number;
    confirmedTotal: string;
    averageTicket: string;
    annulledCount: number;
    annulledTotal: string;
  };
  cashShifts: {
    openCount: number;
    differenceCount30d: number;
    differenceAmount30d: string;
  };
  inventory: {
    pendingAdjustments: number;
    expiringLots: number;
    expiredLots: number;
  };
  fiscal: {
    validated: number;
    pending: number;
    rejected: number;
    errors: number;
    contingency: number;
  };
  sync: { permanentFailures: number };
  users: { pendingApproval: number; activeSessions: number };
  salesTrend: {
    days: {
      /** Local calendar day, YYYY-MM-DD */
      date: string;
      confirmedCount: number;
      /** Decimal string, e.g. "0" or "1234.56" */
      confirmedAmount: string;
    }[];
  };
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getDashboard(user: User): Promise<DashboardResponse> {
    const scope = this.scope.tenantWhere(user);
    const saleScope = this.scope.saleTenantWhere(user);
    const dayStart = this.startOfLocalDay();
    const thirtyDaysAgo = new Date(
      dayStart.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    const expiringBefore = new Date(
      Date.now() + EXPIRING_LOT_DAYS * 24 * 60 * 60 * 1000,
    );
    const userIds = await this.scope.tenantUserIds(user);
    const trendDayStarts = this.buildTrendDayStarts(dayStart);
    const trendEnd = new Date(dayStart);
    trendEnd.setDate(trendEnd.getDate() + 1);

    const [
      confirmedToday,
      trendSales,
      annulledToday,
      openShifts,
      shiftDifferences,
      pendingAdjustments,
      expiringLots,
      expiredLots,
      fiscalByState,
      permanentFailures,
      pendingUsers,
      activeSessions,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          ...saleScope,
          confirmedAt: { gte: dayStart },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.sale.findMany({
        where: {
          ...saleScope,
          confirmedAt: { gte: trendDayStarts[0], lt: trendEnd },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        select: { confirmedAt: true, totalAmount: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          ...saleScope,
          annulledAt: { gte: dayStart },
          operationalState: SaleOperationalState.ANNULLED,
        },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.cashShift.count({
        where: { ...scope, state: ShiftState.OPEN },
      }),
      this.prisma.cashShift.aggregate({
        where: {
          ...scope,
          closedAt: { gte: thirtyDaysAgo },
          closingDifference: { not: 0 },
        },
        _count: { id: true },
        _sum: { closingDifference: true },
      }),
      this.prisma.inventoryAdjustmentDocument.count({
        where: {
          ...scope,
          submittedForApprovalAt: { not: null },
          approvedAt: null,
          rejectedAt: null,
        },
      }),
      this.prisma.lot.count({
        where: {
          currentStock: { gt: 0 },
          expirationDate: { gte: new Date(), lte: expiringBefore },
          product: scope,
        },
      }),
      this.prisma.lot.count({
        where: {
          currentStock: { gt: 0 },
          expirationDate: { lt: new Date() },
          product: scope,
        },
      }),
      this.prisma.fiscalDocument.groupBy({
        by: ['fiscalState'],
        where: { ...scope, issueDate: { gte: dayStart } },
        _count: { _all: true },
      }),
      this.prisma.syncQueue.count({
        where: { ...scope, status: 'PERMANENT_FAILURE' },
      }),
      this.prisma.user.count({
        where: { ...scope, status: UserStatus.PENDING_SETUP },
      }),
      userIds === null
        ? this.prisma.userSession.count({
            where: { status: SessionStatus.ACTIVE },
          })
        : this.prisma.userSession.count({
            where: {
              status: SessionStatus.ACTIVE,
              userId: { in: userIds },
            },
          }),
    ]);

    const confirmedAmount =
      confirmedToday._sum.totalAmount === null ||
      confirmedToday._sum.totalAmount === undefined
        ? null
        : confirmedToday._sum.totalAmount;
    const annulledAmount =
      annulledToday._sum.totalAmount === null ||
      annulledToday._sum.totalAmount === undefined
        ? null
        : annulledToday._sum.totalAmount;
    const differenceAmount =
      shiftDifferences._sum.closingDifference === null ||
      shiftDifferences._sum.closingDifference === undefined
        ? null
        : shiftDifferences._sum.closingDifference;

    const confirmedCount = confirmedToday._count.id;
    const averageTicket =
      confirmedCount > 0 && confirmedAmount !== null
        ? confirmedAmount
            .dividedBy(confirmedCount)
            .toDecimalPlaces(2)
            .toString()
        : '0';

    const fiscalCounts = this.summarizeFiscal(fiscalByState);

    return {
      period: { from: dayStart.toISOString(), to: new Date().toISOString() },
      sales: {
        confirmedCount,
        confirmedTotal: confirmedAmount?.toString() ?? '0',
        averageTicket,
        annulledCount: annulledToday._count.id,
        annulledTotal: annulledAmount?.toString() ?? '0',
      },
      cashShifts: {
        openCount: openShifts,
        differenceCount30d: shiftDifferences._count.id,
        differenceAmount30d: differenceAmount?.toString() ?? '0',
      },
      inventory: {
        pendingAdjustments,
        expiringLots,
        expiredLots,
      },
      fiscal: fiscalCounts,
      sync: { permanentFailures },
      users: { pendingApproval: pendingUsers, activeSessions },
      salesTrend: this.buildSalesTrend(trendSales, trendDayStarts),
    };
  }

  private startOfLocalDay(): Date {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  /**
   * Oldest-first local midnights ending today. setDate (not fixed 24h steps)
   * keeps every bucket on local midnight across DST transitions.
   */
  private buildTrendDayStarts(todayStart: Date): Date[] {
    const days: Date[] = [];
    for (let offset = SALES_TREND_DAYS - 1; offset >= 0; offset -= 1) {
      const day = new Date(todayStart);
      day.setDate(day.getDate() - offset);
      days.push(day);
    }
    return days;
  }

  private buildSalesTrend(
    sales: { confirmedAt: Date | null; totalAmount: Prisma.Decimal }[],
    dayStarts: Date[],
  ): DashboardResponse['salesTrend'] {
    const counts = dayStarts.map(() => 0);
    const amounts = dayStarts.map(() => new Prisma.Decimal(0));
    const bucketIndexByMidnight = new Map(
      dayStarts.map((start, index) => [start.getTime(), index]),
    );

    for (const sale of sales) {
      if (sale.confirmedAt === null) continue;
      // Bucket by the sale's own local-day midnight, not UTC, matching the
      // startOfLocalDay convention used for the dashboard period.
      const saleDayMidnight = new Date(sale.confirmedAt);
      saleDayMidnight.setHours(0, 0, 0, 0);
      const bucketIndex = bucketIndexByMidnight.get(saleDayMidnight.getTime());
      if (bucketIndex === undefined) continue;
      counts[bucketIndex] += 1;
      amounts[bucketIndex] = amounts[bucketIndex].plus(sale.totalAmount);
    }

    return {
      days: dayStarts.map((start, index) => ({
        date: this.formatLocalDate(start),
        confirmedCount: counts[index],
        confirmedAmount: amounts[index].toString(),
      })),
    };
  }

  /** Local YYYY-MM-DD; toISOString would shift the day near UTC offsets. */
  private formatLocalDate(day: Date): string {
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(day.getDate()).padStart(2, '0');
    return `${day.getFullYear()}-${month}-${dayOfMonth}`;
  }

  private summarizeFiscal(
    rows: { fiscalState: string; _count: { _all: number } }[],
  ): DashboardResponse['fiscal'] {
    const pendingStates = new Set([
      'PENDING_GENERATION',
      'PENDING_SIGNATURE',
      'PENDING_TRANSMISSION',
      'IN_TRANSMISSION',
      'PENDING_RESPONSE',
    ]);
    const errorStates = new Set(['GENERATION_ERROR', 'SIGNATURE_ERROR']);
    let validated = 0;
    let pending = 0;
    let rejected = 0;
    let errors = 0;
    let contingency = 0;

    for (const row of rows) {
      const count = row._count._all;
      switch (row.fiscalState) {
        case 'VALIDATED':
          validated += count;
          break;
        case 'REJECTED':
          rejected += count;
          break;
        case 'CONTINGENCY':
          contingency += count;
          break;
        default:
          if (pendingStates.has(row.fiscalState)) pending += count;
          else if (errorStates.has(row.fiscalState)) errors += count;
          break;
      }
    }

    return { validated, pending, rejected, errors, contingency };
  }
}
