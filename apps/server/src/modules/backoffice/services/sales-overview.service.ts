/**
 * Backoffice sales overview — paginated sale listing with totals summary
 * for the caller's tenant. Read-only; mutations stay in sales-pos.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BackofficeScopeService } from './backoffice-scope.service';

export interface SalesOverviewQuery {
  from?: string;
  to?: string;
  state?: string;
  userId?: string;
  workstationId?: string;
  page?: number;
  pageSize?: number;
}

export interface SalesOverviewResult {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    count: number;
    totalAmount: string;
    totalTax: string;
    totalDiscount: string;
  };
}

@Injectable()
export class SalesOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getSales(
    user: User,
    query: SalesOverviewQuery,
  ): Promise<SalesOverviewResult> {
    const where: Record<string, unknown> = {
      ...this.scope.saleTenantWhere(user),
    };

    if (query.from || query.to) {
      where.confirmedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.state) {
      where.operationalState = query.state;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.workstationId) {
      where.workstationId = query.workstationId;
    }

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [data, total, summary] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { confirmedAt: { sort: 'desc', nulls: 'last' } },
        skip,
        take: pageSize,
        select: {
          id: true,
          localNumber: true,
          internalNumber: true,
          operationalState: true,
          confirmedAt: true,
          annulledAt: true,
          subtotal: true,
          totalDiscount: true,
          totalTax: true,
          totalAmount: true,
          annulmentReason: true,
          clientNameSnapshot: true,
          userId: true,
          workstationId: true,
          user: { select: { displayName: true, fullName: true } },
          workstation: { select: { name: true, code: true } },
        },
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where: { ...where, confirmedAt: { not: null } },
        _count: { id: true },
        _sum: { totalAmount: true, totalTax: true, totalDiscount: true },
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      summary: {
        count: summary._count.id,
        totalAmount: summary._sum.totalAmount?.toString() ?? '0',
        totalTax: summary._sum.totalTax?.toString() ?? '0',
        totalDiscount: summary._sum.totalDiscount?.toString() ?? '0',
      },
    };
  }
}
