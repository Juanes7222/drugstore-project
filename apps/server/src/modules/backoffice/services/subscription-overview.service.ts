/**
 * Backoffice subscription overview — every customer subscription with its
 * plan and activation counts. SAAS_ADMIN only: this is the platform-level
 * view of all tenants.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export interface SubscriptionsOverviewQuery {
  page?: number;
  pageSize?: number;
}

export interface SubscriptionsOverviewResult {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class SubscriptionOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscriptions(
    _user: User,
    query: SubscriptionsOverviewQuery,
  ): Promise<SubscriptionsOverviewResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [data, total] = await Promise.all([
      this.prisma.subscription.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
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
        },
      }),
      this.prisma.subscription.count(),
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
