/**
 * SaaS-admin revenue reporting — read-only aggregates over
 * SubscriptionPaymentHistory rows, which are written by Wompi webhook
 * processing (approved transactions) and by admin payment recordings.
 * Amounts are stored as integer cents and leave this service as decimal
 * strings in main currency units; the deployment is single-currency (COP),
 * so cross-currency totals are not a concern here.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, SubscriptionStatus } from '@pharmacy/database';
import type { BillingPeriod } from '@pharmacy/database';
import { SaasAdminAccessAuditService } from './saas-admin-access-audit.service';
import { SubscriptionNotFoundException } from '../exceptions/subscription-not-found.exception';

export interface SaasAdminRevenueWindow {
  totalAmount: string;
  count: number;
}

/** One zero-filled month bucket of GET /saas-admin/revenue. */
export interface SaasAdminMonthlyRevenue {
  /** 'YYYY-MM' (local calendar month). */
  month: string;
  totalAmount: string;
  count: number;
}

export interface SaasAdminPlanDistributionRow {
  planCode: string;
  planName: string;
  activeSubscriptions: number;
}

export interface SaasAdminRevenueResult {
  last30d: SaasAdminRevenueWindow;
  /** Last 12 calendar months including the current one, oldest first. */
  revenueByMonth: SaasAdminMonthlyRevenue[];
  planDistribution: SaasAdminPlanDistributionRow[];
  /**
   * Monthly recurring revenue of ACTIVE subscriptions, normalized to one
   * month (MONTHLY ×1, QUARTERLY ÷3, ANNUAL ÷12). Null when there are no
   * ACTIVE subscriptions or every plan price is zero.
   */
  mrr: string | null;
}

/** One row of GET /saas-admin/customers/:id/payments. Adapted to the real
 *  SubscriptionPaymentHistory model: no payment-status column exists on it
 *  (only the separate SubscriptionPendingPayment workflow rows carry one),
 *  so `recordedAt` is the payment timestamp and `externalReference` carries
 *  the Wompi reference / receipt id. */
export interface SaasAdminPaymentRow {
  id: string;
  amount: string;
  currency: string;
  method: string | null;
  externalReference: string | null;
  recordedAt: string;
  createdAt: string;
}

export interface SaasAdminCustomerPaymentsResult {
  data: SaasAdminPaymentRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const REVENUE_MONTHS = 12;
const CENTS_PER_UNIT = new Prisma.Decimal(100);
/** Months one billing period covers — the MRR normalization divisor. */
const BILLING_PERIOD_MONTHS: Record<BillingPeriod, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

type PaymentForBucketing = {
  amountCents: number;
  recordedAt: Date;
};

@Injectable()
export class SaasAdminRevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessAudit: SaasAdminAccessAuditService,
  ) {}

  async getRevenue(): Promise<SaasAdminRevenueResult> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(
      dayStart.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    const windowStart = this.startOfMonthNMonthsAgo(REVENUE_MONTHS - 1);

    // One fetch covers both the trailing-30-day window and all 12 monthly
    // buckets; per-customer SaaS payment volume is small enough to bucket
    // in memory (Prisma groupBy cannot bucket by month directly).
    const [payments, planGroups] = await Promise.all([
      this.prisma.subscriptionPaymentHistory.findMany({
        where: { recordedAt: { gte: windowStart } },
        select: { amountCents: true, recordedAt: true },
      }),
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: SubscriptionStatus.ACTIVE },
        _count: { _all: true },
      }),
    ]);

    const plans = await this.prisma.plan.findMany({
      where: { id: { in: planGroups.map((group) => group.planId) } },
      select: {
        id: true,
        code: true,
        name: true,
        basePriceCents: true,
        billingPeriod: true,
        displayOrder: true,
      },
    });
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    return {
      last30d: this.summarizeLast30Days(payments, thirtyDaysAgo),
      revenueByMonth: this.bucketByMonth(payments),
      planDistribution: this.buildPlanDistribution(planGroups, planById),
      mrr: this.computeMrr(planGroups, planById),
    };
  }

  /**
   * Paged payment history for one subscription, newest first. Every
   * per-customer route writes an ACCESS audit entry like the module's reads.
   */
  async getCustomerPayments(
    actor: { id: string; role: string },
    subscriptionId: string,
    query: { page?: number; pageSize?: number },
  ): Promise<SaasAdminCustomerPaymentsResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true },
    });
    if (!subscription) {
      throw new SubscriptionNotFoundException(subscriptionId);
    }

    const [rows, total] = await Promise.all([
      this.prisma.subscriptionPaymentHistory.findMany({
        where: { subscriptionId },
        orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.subscriptionPaymentHistory.count({
        where: { subscriptionId },
      }),
    ]);

    await this.accessAudit.recordCustomerAccess({
      actorUser: actor,
      subscriptionId,
      endpoint: `/saas-admin/customers/${subscriptionId}/payments`,
    });

    return {
      data: rows.map(this.toPaymentRow),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private summarizeLast30Days(
    payments: PaymentForBucketing[],
    thirtyDaysAgo: Date,
  ): SaasAdminRevenueWindow {
    let cents = new Prisma.Decimal(0);
    let count = 0;
    for (const payment of payments) {
      if (payment.recordedAt >= thirtyDaysAgo) {
        cents = cents.plus(payment.amountCents);
        count += 1;
      }
    }
    return { totalAmount: centsToUnitsString(cents), count };
  }

  private bucketByMonth(payments: PaymentForBucketing[]): SaasAdminMonthlyRevenue[] {
    const buckets = new Map<string, { cents: Prisma.Decimal; count: number }>();
    for (let i = REVENUE_MONTHS - 1; i >= 0; i -= 1) {
      buckets.set(monthKeyOf(this.startOfMonthNMonthsAgo(i)), {
        cents: new Prisma.Decimal(0),
        count: 0,
      });
    }

    for (const payment of payments) {
      const bucket = buckets.get(monthKeyOf(payment.recordedAt));
      if (!bucket) {
        continue;
      }
      bucket.cents = bucket.cents.plus(payment.amountCents);
      bucket.count += 1;
    }

    return [...buckets.entries()].map(([month, bucket]) => ({
      month,
      totalAmount: centsToUnitsString(bucket.cents),
      count: bucket.count,
    }));
  }

  private buildPlanDistribution(
    planGroups: { planId: string; _count: { _all: number } }[],
    planById: Map<string, { code: string; name: string; displayOrder: number }>,
  ): SaasAdminPlanDistributionRow[] {
    return planGroups
      .map((group) => {
        const plan = planById.get(group.planId);
        // The FK guarantees the plan exists; the guard only satisfies strict TS.
        return plan
          ? {
              planCode: plan.code,
              planName: plan.name,
              activeSubscriptions: group._count._all,
              displayOrder: plan.displayOrder,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort(
        (a, b) =>
          a.displayOrder - b.displayOrder || a.planCode.localeCompare(b.planCode),
      )
      .map(({ planCode, planName, activeSubscriptions }) => ({
        planCode,
        planName,
        activeSubscriptions,
      }));
  }

  /**
   * MRR case: Plan carries a recurring price (`basePriceCents`, non-null,
   * with PricingModel FLAT/PER_LOCATION/PER_WORKSTATION/TIERED — none are
   * one-time), so MRR is computable. Each ACTIVE subscription contributes
   * its plan price normalized to one month; rounding to 2 decimals happens
   * once at the end. Returns null with zero priced subscriptions.
   */
  private computeMrr(
    planGroups: { planId: string; _count: { _all: number } }[],
    planById: Map<
      string,
      { basePriceCents: number; billingPeriod: BillingPeriod }
    >,
  ): string | null {
    let monthlyCents = new Prisma.Decimal(0);
    for (const group of planGroups) {
      const plan = planById.get(group.planId);
      if (!plan || plan.basePriceCents === 0) {
        continue;
      }
      const normalized = new Prisma.Decimal(plan.basePriceCents).dividedBy(
        BILLING_PERIOD_MONTHS[plan.billingPeriod],
      );
      monthlyCents = monthlyCents.plus(normalized.times(group._count._all));
    }
    if (monthlyCents.isZero()) {
      return null;
    }
    return monthlyCents.toDecimalPlaces(2).dividedBy(CENTS_PER_UNIT).toString();
  }

  /** Local midnight of the first day of the month N months before today. */
  private startOfMonthNMonthsAgo(monthsAgo: number): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  }

  private toPaymentRow(row: {
    id: string;
    amountCents: number;
    currency: string;
    paymentMethod: string | null;
    paymentReference: string | null;
    recordedAt: Date;
    createdAt: Date;
  }): SaasAdminPaymentRow {
    return {
      id: row.id,
      amount: centsToUnitsString(new Prisma.Decimal(row.amountCents)),
      currency: row.currency,
      method: row.paymentMethod,
      externalReference: row.paymentReference,
      recordedAt: row.recordedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function monthKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

/** Integer cents → decimal string in main units (e.g. 123450 → "1234.5"). */
function centsToUnitsString(cents: Prisma.Decimal): string {
  return cents.dividedBy(CENTS_PER_UNIT).toString();
}
