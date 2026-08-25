/**
 * SaaS-admin at-risk report — ACTIVE/TRIAL subscriptions whose latest
 * confirmed sale is older than a window (or that never sold), so the
 * platform team can reach out before churn. Sale enforces FORCE ROW LEVEL
 * SECURITY, so the latest-sale lookup runs once per subscription inside an
 * RLS-scoped transaction — the same pattern as the overview's
 * lastActivityAt fallback (latest confirmed sale via cashShift.subscriptionId).
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  SaleOperationalState,
  SubscriptionStatus,
} from '@pharmacy/database';
import { aggregateAcrossTenants } from './saas-admin-tenant-aggregation';

/** One row of GET /saas-admin/at-risk; never-sold rows carry lastSaleAt null. */
export interface SaasAdminAtRiskRow {
  subscriptionId: string;
  customerName: string;
  customerEmail: string | null;
  status: string;
  lastSaleAt: string | null;
  workstationActivations: number;
}

/** Hard cap on returned rows regardless of how many tenants qualify. */
const AT_RISK_LIMIT = 100;

@Injectable()
export class SaasAdminAtRiskService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Subscriptions whose latest confirmed sale is strictly older than the
   * cutoff (now minus inactiveDays calendar days) or that never sold.
   * Rows come most-stale first with never-sold treated as stalest,
   * capped at AT_RISK_LIMIT.
   */
  async getAtRiskCustomers(inactiveDays: number): Promise<SaasAdminAtRiskRow[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - inactiveDays);

    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
      },
      select: {
        id: true,
        customerName: true,
        customerEmail: true,
        status: true,
        _count: { select: { workstationActivations: true } },
      },
    });

    const lastSales = await aggregateAcrossTenants(
      this.prisma,
      candidates.map((candidate) => candidate.id),
      async (tx, subscriptionId) => {
        const latest = await tx.sale.findFirst({
          where: {
            cashShift: { subscriptionId },
            confirmedAt: { not: null },
            operationalState: SaleOperationalState.CONFIRMED,
          },
          orderBy: { confirmedAt: 'desc' },
          select: { confirmedAt: true },
        });
        return latest?.confirmedAt ?? null;
      },
    );

    const rows: SaasAdminAtRiskRow[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i] as (typeof candidates)[number];
      const lastSaleAt = lastSales[i];
      // Strictly older than the cutoff: a sale inside the window keeps the
      // tenant out even if older sales predate it.
      if (lastSaleAt && lastSaleAt >= cutoff) {
        continue;
      }
      rows.push({
        subscriptionId: candidate.id,
        customerName: candidate.customerName,
        customerEmail: candidate.customerEmail,
        status: candidate.status,
        lastSaleAt: lastSaleAt ? lastSaleAt.toISOString() : null,
        workstationActivations: candidate._count.workstationActivations,
      });
    }

    return rows
      .sort(byMostStaleFirst)
      .slice(0, AT_RISK_LIMIT);
  }
}

/** ISO-8601 UTC strings compare chronologically as plain strings. */
function byMostStaleFirst(a: SaasAdminAtRiskRow, b: SaasAdminAtRiskRow): number {
  if (!a.lastSaleAt && !b.lastSaleAt) {
    return 0;
  }
  if (!a.lastSaleAt) {
    return -1;
  }
  if (!b.lastSaleAt) {
    return 1;
  }
  return a.lastSaleAt.localeCompare(b.lastSaleAt);
}
