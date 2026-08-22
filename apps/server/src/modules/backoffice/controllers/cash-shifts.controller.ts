/**
 * Backoffice cash-shifts controller — read-only shift listing with a
 * closing-difference summary.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import {
  CashShiftsOverviewQuery,
  CashShiftOverviewService,
} from '../services/cash-shift-overview.service';

interface CashShiftsQueryParams {
  from?: string;
  to?: string;
  state?: string;
  workstationId?: string;
  userId?: string;
  page?: string;
  pageSize?: string;
}

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashShiftsController {
  constructor(private readonly cashShiftOverview: CashShiftOverviewService) {}

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
    const parsed: CashShiftsOverviewQuery = {
      from: query.from,
      to: query.to,
      state: query.state,
      workstationId: query.workstationId,
      userId: query.userId,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.cashShiftOverview.getCashShifts(user, parsed);
  }
}
