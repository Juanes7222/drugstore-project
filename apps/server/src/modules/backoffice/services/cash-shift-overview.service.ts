/**
 * Backoffice cash-shift overview — paginated shift listing with a
 * closing-difference summary for the caller's tenant. Read-only;
 * shift lifecycle stays in cash-shift.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BackofficeScopeService } from './backoffice-scope.service';

export interface CashShiftsOverviewQuery {
  from?: string;
  to?: string;
  state?: string;
  workstationId?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export interface CashShiftsOverviewResult {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    differenceCount: number;
    differenceAmount: string;
  };
}

@Injectable()
export class CashShiftOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getCashShifts(
    user: User,
    query: CashShiftsOverviewQuery,
  ): Promise<CashShiftsOverviewResult> {
    const where: Record<string, unknown> = {
      ...this.scope.tenantWhere(user),
    };

    if (query.from || query.to) {
      where.openedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.state) {
      where.state = query.state;
    }
    if (query.workstationId) {
      where.workstationId = query.workstationId;
    }
    if (query.userId) {
      where.userId = query.userId;
    }

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [data, total, summary] = await Promise.all([
      this.prisma.cashShift.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          workstationId: true,
          userId: true,
          state: true,
          openedAt: true,
          closedAt: true,
          openingBalance: true,
          expectedClosingAmount: true,
          actualClosingAmount: true,
          closingDifference: true,
          closingNotes: true,
          forcedClose: true,
          hasExtendedAlert: true,
          user: { select: { displayName: true, fullName: true } },
          workstation: { select: { name: true, code: true } },
        },
      }),
      this.prisma.cashShift.count({ where }),
      this.prisma.cashShift.aggregate({
        where: { ...where, closingDifference: { not: 0 } },
        _count: { id: true },
        _sum: { closingDifference: true },
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      summary: {
        differenceCount: summary._count.id,
        differenceAmount: summary._sum.closingDifference?.toString() ?? '0',
      },
    };
  }
}
