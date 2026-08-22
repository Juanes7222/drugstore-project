/**
 * Backoffice sales controller — read-only sale listing with totals.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import {
  SalesOverviewQuery,
  SalesOverviewService,
} from '../services/sales-overview.service';

interface SalesQueryParams {
  from?: string;
  to?: string;
  state?: string;
  userId?: string;
  workstationId?: string;
  page?: string;
  pageSize?: string;
}

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly salesOverview: SalesOverviewService) {}

  /**
   * GET /backoffice/sales — ventas del tenant con filtros de fecha, estado,
   * usuario y terminal. Incluye resumen de totales.
   */
  @Get('sales')
  @Roles(RoleType.ADMIN)
  getSales(@CurrentUser() user: User, @Query() query: SalesQueryParams) {
    const parsed: SalesOverviewQuery = {
      from: query.from,
      to: query.to,
      state: query.state,
      userId: query.userId,
      workstationId: query.workstationId,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.salesOverview.getSales(user, parsed);
  }
}
