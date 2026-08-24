/**
 * Backoffice cash-shifts controller — read-only shift listing with a
 * closing-difference summary.
 */

import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import {
  CashShiftsFilterQuery,
  CashShiftOverviewService,
} from '../services/cash-shift-overview.service';
import { CsvBuilderService } from '../services/csv-builder.service';

interface CashShiftsQueryParams {
  from?: string;
  to?: string;
  state?: string;
  workstationId?: string;
  userId?: string;
  page?: string;
  pageSize?: string;
}

function toCashShiftsFilterQuery(query: CashShiftsQueryParams): CashShiftsFilterQuery {
  return {
    from: query.from,
    to: query.to,
    state: query.state,
    workstationId: query.workstationId,
    userId: query.userId,
  };
}

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashShiftsController {
  constructor(
    private readonly cashShiftOverview: CashShiftOverviewService,
    private readonly csvBuilder: CsvBuilderService,
  ) {}

  /**
   * GET /backoffice/cash-shifts — turnos del tenant con resumen de
   * diferencias de arqueo.
   */
  @Get('cash-shifts')
  @Roles(RoleType.ADMIN)
  getCashShifts(
    @CurrentUser() user: User,
    @Query() query: CashShiftsQueryParams,
  ) {
    const parsed = {
      ...toCashShiftsFilterQuery(query),
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.cashShiftOverview.getCashShifts(user, parsed);
  }

  /**
   * GET /backoffice/cash-shifts/export — CSV de todos los turnos que
   * coinciden con los filtros.
   */
  @Get('cash-shifts/export')
  @Roles(RoleType.ADMIN)
  async exportCashShifts(
    @CurrentUser() user: User,
    @Query() query: CashShiftsQueryParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const csv = await this.cashShiftOverview.getCashShiftsCsv(
      user,
      toCashShiftsFilterQuery(query),
    );
    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="turnos-caja-${this.csvBuilder.exportFileStamp()}.csv"`,
    });
    return csv;
  }
}
