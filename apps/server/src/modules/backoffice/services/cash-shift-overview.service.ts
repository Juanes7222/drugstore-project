/**
 * Backoffice cash-shift overview — paginated shift listing with a
 * closing-difference summary plus CSV export for the caller's tenant.
 * Read-only; shift lifecycle stays in cash-shift. User/workstation
 * display data is joined in memory via BackofficeActorLookupService
 * because CashShift declares no relation fields to those models.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@pharmacy/database';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BackofficeScopeService } from './backoffice-scope.service';
import {
  ActorSummary,
  BackofficeActorLookupService,
  WorkstationSummary,
} from './backoffice-actor-lookup.service';
import { CsvBuilderService } from './csv-builder.service';

export interface CashShiftsFilterQuery {
  from?: string;
  to?: string;
  state?: string;
  workstationId?: string;
  userId?: string;
}

export interface CashShiftsOverviewQuery extends CashShiftsFilterQuery {
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

const CASH_SHIFT_LIST_SELECT = {
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
} satisfies Prisma.CashShiftSelect;

type CashShiftListPayload = Prisma.CashShiftGetPayload<{
  select: typeof CASH_SHIFT_LIST_SELECT;
}>;

const CASH_SHIFT_CSV_SELECT = {
  openedAt: true,
  closedAt: true,
  state: true,
  forcedClose: true,
  openingBalance: true,
  expectedClosingAmount: true,
  actualClosingAmount: true,
  closingDifference: true,
  closingNotes: true,
  userId: true,
  workstationId: true,
} satisfies Prisma.CashShiftSelect;

type CashShiftCsvPayload = Prisma.CashShiftGetPayload<{
  select: typeof CASH_SHIFT_CSV_SELECT;
}>;

// Spanish headers are product content for the exported file, matching the
// backoffice UI vocabulary — not user-facing error text.
const CASH_SHIFT_CSV_HEADERS = [
  'Abierto',
  'Cerrado',
  'Estado',
  'Terminal',
  'Cajero',
  'Fondo inicial',
  'Esperado',
  'Contado',
  'Diferencia',
  'Cierre forzado',
  'Notas',
] as const;

@Injectable()
export class CashShiftOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
    private readonly actorLookup: BackofficeActorLookupService,
    private readonly csvBuilder: CsvBuilderService,
  ) {}

  async getCashShifts(
    user: User,
    query: CashShiftsOverviewQuery,
  ): Promise<CashShiftsOverviewResult> {
    const where: Record<string, unknown> = {
      ...this.scope.tenantWhere(user),
      ...this.buildCashShiftFilters(query),
    };

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [shifts, total, summary] = await Promise.all([
      this.prisma.cashShift.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip,
        take: pageSize,
        select: CASH_SHIFT_LIST_SELECT,
      }),
      this.prisma.cashShift.count({ where }),
      this.prisma.cashShift.aggregate({
        where: { ...where, closingDifference: { not: 0 } },
        _count: { id: true },
        _sum: { closingDifference: true },
      }),
    ]);

    const [usersById, workstationsById] = await Promise.all([
      this.actorLookup.loadUsersById(shifts.map((shift) => shift.userId)),
      this.actorLookup.loadWorkstationsById(
        shifts.map((shift) => shift.workstationId),
      ),
    ]);

    return {
      data: shifts.map((shift) =>
        this.withActorData(
          shift,
          usersById.get(shift.userId),
          workstationsById.get(shift.workstationId),
        ),
      ),
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

  /**
   * CSV export of every cash shift matching the list filters, without
   * pagination. Returns the full payload (BOM included); the controller
   * sets headers.
   */
  async getCashShiftsCsv(
    user: User,
    query: CashShiftsFilterQuery,
  ): Promise<string> {
    const shifts = await this.prisma.cashShift.findMany({
      where: {
        ...this.scope.tenantWhere(user),
        ...this.buildCashShiftFilters(query),
      },
      orderBy: { openedAt: 'desc' },
      select: CASH_SHIFT_CSV_SELECT,
    });

    const [usersById, workstationsById] = await Promise.all([
      this.actorLookup.loadUsersById(shifts.map((shift) => shift.userId)),
      this.actorLookup.loadWorkstationsById(
        shifts.map((shift) => shift.workstationId),
      ),
    ]);

    return this.csvBuilder.buildCsv(
      CASH_SHIFT_CSV_HEADERS,
      shifts.map((shift) =>
        this.toCashShiftCsvRow(
          shift,
          usersById.get(shift.userId),
          workstationsById.get(shift.workstationId),
        ),
      ),
    );
  }

  private buildCashShiftFilters(
    query: CashShiftsFilterQuery,
  ): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    if (query.from || query.to) {
      filters.openedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.state) {
      filters.state = query.state;
    }
    if (query.workstationId) {
      filters.workstationId = query.workstationId;
    }
    if (query.userId) {
      filters.userId = query.userId;
    }
    return filters;
  }

  /**
   * Attach the user/workstation display objects the list API has always
   * returned, keeping the response shape stable across the lookup change.
   * A deleted referenced row falls back to empty strings rather than
   * dropping the shift from the listing.
   */
  private withActorData(
    shift: CashShiftListPayload,
    actor: ActorSummary | undefined,
    workstation: WorkstationSummary | undefined,
  ) {
    return {
      ...shift,
      user: {
        displayName: actor?.displayName ?? null,
        fullName: actor?.fullName ?? '',
      },
      workstation: {
        name: workstation?.name ?? '',
        code: workstation?.code ?? '',
      },
    };
  }

  private toCashShiftCsvRow(
    shift: CashShiftCsvPayload,
    actor: ActorSummary | undefined,
    workstation: WorkstationSummary | undefined,
  ): string[] {
    return [
      this.csvBuilder.formatDateTime(shift.openedAt),
      this.csvBuilder.formatDateTime(shift.closedAt),
      shift.state,
      workstation?.name ?? '',
      actor ? (actor.displayName ?? actor.fullName) : '',
      shift.openingBalance.toString(),
      shift.expectedClosingAmount.toString(),
      shift.actualClosingAmount.toString(),
      shift.closingDifference.toString(),
      shift.forcedClose ? 'Sí' : 'No',
      shift.closingNotes ?? '',
    ];
  }
}
