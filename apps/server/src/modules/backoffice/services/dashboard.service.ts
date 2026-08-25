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
import { buildSalesTrendDays, type TrendSale } from './sales-trend';

const EXPIRING_LOT_DAYS = 90;
/** Trend series length for the default `today` period; other periods use one bucket per window day. */
const TODAY_SALES_TREND_DAYS = 14;

export type DashboardPeriod = 'today' | '7d' | '30d';

/** Calendar days covered by each period, today included (today = 1 day so far). */
const PERIOD_DAY_COUNTS: Record<DashboardPeriod, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
};

export interface DashboardSalesTotals {
  count: number;
  total: Prisma.Decimal;
}

export interface DashboardResponse {
  period: { from: string; to: string };
  sales: {
    confirmedCount: number;
    confirmedTotal: string;
    averageTicket: string;
    annulledCount: number;
    annulledTotal: string;
    /** Confirmed sales of the immediately preceding window of equal length. */
    previousCount: number;
    previousTotal: string;
    previousAverageTicket: string | null;
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

  async getDashboard(
    user: User,
    period: DashboardPeriod = 'today',
  ): Promise<DashboardResponse> {
    const scope = this.scope.tenantWhere(user);
    const saleScope = this.scope.saleTenantWhere(user);
    const dayStart = this.startOfLocalDay();
    const windowDayCount = PERIOD_DAY_COUNTS[period];
    // Current window: today so far, or (N-1) full local days plus today so far.
    const windowFrom = this.addCalendarDays(dayStart, -(windowDayCount - 1));
    // Immediately preceding window of equal length, anchored on local
    // midnights (not a sliding to-now window) so buckets stay day-aligned.
    const previousFrom = this.addCalendarDays(windowFrom, -windowDayCount);
    // `today` keeps its fixed 14-day trend series; other periods bucket the
    // whole selected window one day per entry.
    const trendDayStarts = this.buildTrendDayStarts(
      dayStart,
      period === 'today' ? TODAY_SALES_TREND_DAYS : windowDayCount,
    );
    const trendEnd = this.addCalendarDays(dayStart, 1);
    // For non-today periods the current window IS the trend range, so the
    // confirmed-window aggregate is skipped and metrics are derived from the
    // single range query below, widened to also cover the previous window.
    const useConfirmedAggregate = period === 'today';
    const rangeStart = new Date(
      Math.min(trendDayStarts[0].getTime(), previousFrom.getTime()),
    );
    const thirtyDaysAgo = new Date(
      dayStart.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    const expiringBefore = new Date(
      Date.now() + EXPIRING_LOT_DAYS * 24 * 60 * 60 * 1000,
    );

    const [
      confirmedAggregate,
      rangeSales,
      annulledWindow,
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
      useConfirmedAggregate
        ? this.prisma.sale.aggregate({
            where: {
              ...saleScope,
              confirmedAt: { gte: dayStart },
              operationalState: SaleOperationalState.CONFIRMED,
            },
            _count: { id: true },
            _sum: { totalAmount: true },
          })
        : Promise.resolve(null),
      this.prisma.sale.findMany({
        where: {
          ...saleScope,
          confirmedAt: { gte: rangeStart, lt: trendEnd },
          operationalState: SaleOperationalState.CONFIRMED,
        },
        select: { confirmedAt: true, totalAmount: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          ...saleScope,
          annulledAt: { gte: windowFrom },
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
      // tenantUserIds always returns ids (it throws for callers without a
      // subscription), so the session count is always tenant-scoped.
      this.prisma.userSession.count({
        where: {
          status: SessionStatus.ACTIVE,
          userId: { in: await this.scope.tenantUserIds(user) },
        },
      }),
    ]);

    const confirmedWindow = confirmedAggregate
      ? {
          count: confirmedAggregate._count.id,
          total: confirmedAggregate._sum.totalAmount ?? new Prisma.Decimal(0),
        }
      : this.summarizeConfirmedSales(rangeSales, windowFrom, trendEnd);
    const previousWindow = this.summarizeConfirmedSales(
      rangeSales,
      previousFrom,
      windowFrom,
    );

    const annulledAmount =
      annulledWindow._sum.totalAmount === null ||
      annulledWindow._sum.totalAmount === undefined
        ? null
        : annulledWindow._sum.totalAmount;
    const differenceAmount =
      shiftDifferences._sum.closingDifference === null ||
      shiftDifferences._sum.closingDifference === undefined
        ? null
        : shiftDifferences._sum.closingDifference;

    const averageTicket =
      this.decimalAverage(confirmedWindow.total, confirmedWindow.count) ?? '0';

    const fiscalCounts = this.summarizeFiscal(fiscalByState);

    return {
      period: {
        from: windowFrom.toISOString(),
        to: new Date().toISOString(),
      },
      sales: {
        confirmedCount: confirmedWindow.count,
        confirmedTotal: confirmedWindow.total.toString(),
        averageTicket,
        annulledCount: annulledWindow._count.id,
        annulledTotal: annulledAmount?.toString() ?? '0',
        previousCount: previousWindow.count,
        previousTotal: previousWindow.total.toString(),
        previousAverageTicket: this.decimalAverage(
          previousWindow.total,
          previousWindow.count,
        ),
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
      salesTrend: this.buildSalesTrend(rangeSales, trendDayStarts),
    };
  }

  private startOfLocalDay(): Date {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  /** Shifts by calendar days via setDate so local midnights survive DST. */
  private addCalendarDays(day: Date, days: number): Date {
    const shifted = new Date(day);
    shifted.setDate(shifted.getDate() + days);
    return shifted;
  }

  /**
   * Oldest-first local midnights ending today. setDate (not fixed 24h steps)
   * keeps every bucket on local midnight across DST transitions.
   */
  private buildTrendDayStarts(todayStart: Date, dayCount: number): Date[] {
    const days: Date[] = [];
    for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
      const day = new Date(todayStart);
      day.setDate(day.getDate() - offset);
      days.push(day);
    }
    return days;
  }

  /**
   * Confirmed-sale count and total for [from, toExclusive), computed from the
   * already-fetched range rows so window metrics cost no extra round trip.
   */
  private summarizeConfirmedSales(
    sales: { confirmedAt: Date | null; totalAmount: Prisma.Decimal }[],
    from: Date,
    toExclusive: Date,
  ): DashboardSalesTotals {
    let count = 0;
    let total = new Prisma.Decimal(0);
    for (const sale of sales) {
      if (
        sale.confirmedAt === null ||
        sale.confirmedAt < from ||
        sale.confirmedAt >= toExclusive
      ) {
        continue;
      }
      count += 1;
      total = total.plus(sale.totalAmount);
    }
    return { count, total };
  }

  /** Mean as a rounded decimal string; null when there is nothing to average. */
  private decimalAverage(total: Prisma.Decimal, count: number): string | null {
    return count > 0
      ? total.dividedBy(count).toDecimalPlaces(2).toString()
      : null;
  }

  private buildSalesTrend(
    sales: TrendSale[],
    dayStarts: Date[],
  ): DashboardResponse['salesTrend'] {
    const days = buildSalesTrendDays(sales, dayStarts);
    return {
      days: days.map((day) => ({
        date: day.date,
        confirmedCount: day.count,
        confirmedAmount: day.totalAmount,
      })),
    };
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
