/**
 * Backoffice fiscal status — DIAN document counts by state plus the most
 * recent rejected documents for the caller's tenant. Read-only;
 * transmission stays in fiscal-dian / fiscal-engine.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BackofficeScopeService } from './backoffice-scope.service';

export interface FiscalStatusResult {
  countsByState: { fiscalState: string; count: number }[];
  recentRejected: unknown[];
}

@Injectable()
export class FiscalStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getStatus(user: User, from?: string): Promise<FiscalStatusResult> {
    return this.collect(this.scope.tenantWhere(user), from);
  }

  /**
   * Explicit-subscription variant used by the saas-admin module: same
   * response shape, scoped to the given subscription instead of the
   * caller's own.
   */
  async getStatusForSubscription(
    subscriptionId: string,
    from?: string,
  ): Promise<FiscalStatusResult> {
    return this.collect({ subscriptionId }, from);
  }

  private async collect(
    scope: Record<string, unknown>,
    from?: string,
  ): Promise<FiscalStatusResult> {
    const where: Record<string, unknown> = { ...scope };
    if (from) {
      where.issueDate = { gte: new Date(from) };
    }

    const [grouped, recentRejected] = await Promise.all([
      this.prisma.fiscalDocument.groupBy({
        by: ['fiscalState'],
        where,
        _count: { _all: true },
      }),
      this.prisma.fiscalDocument.findMany({
        where: { ...scope, fiscalState: 'REJECTED' },
        orderBy: { issueDate: 'desc' },
        take: 20,
        select: {
          id: true,
          documentType: true,
          fullNumber: true,
          issueDate: true,
          fiscalState: true,
          ptResponseCode: true,
          ptResponseMessage: true,
          retryCount: true,
          totalAmount: true,
          saleId: true,
        },
      }),
    ]);

    const countsByState = grouped
      .map((g) => ({ fiscalState: g.fiscalState, count: g._count._all }))
      .sort((a, b) => b.count - a.count);

    return { countsByState, recentRejected };
  }
}
