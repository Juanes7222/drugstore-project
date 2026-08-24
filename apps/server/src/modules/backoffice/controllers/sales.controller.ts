/**
 * Backoffice sales controller — read-only sale listing with totals, single
 * sale detail, and CSV export.
 */

import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import {
  SalesFilterQuery,
  SalesOverviewService,
} from '../services/sales-overview.service';
import { CsvBuilderService } from '../services/csv-builder.service';

interface SalesQueryParams {
  from?: string;
  to?: string;
  state?: string;
  userId?: string;
  workstationId?: string;
  page?: string;
  pageSize?: string;
}

function toSalesFilterQuery(query: SalesQueryParams): SalesFilterQuery {
  return {
    from: query.from,
    to: query.to,
    state: query.state,
    userId: query.userId,
    workstationId: query.workstationId,
  };
}

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(
    private readonly salesOverview: SalesOverviewService,
    private readonly csvBuilder: CsvBuilderService,
  ) {}

  /**
   * GET /backoffice/sales — ventas del tenant con filtros de fecha, estado,
   * usuario y terminal. Incluye resumen de totales.
   */
  @Get('sales')
  @Roles(RoleType.ADMIN)
  getSales(@CurrentUser() user: User, @Query() query: SalesQueryParams) {
    const parsed = {
      ...toSalesFilterQuery(query),
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.salesOverview.getSales(user, parsed);
  }

  /**
   * GET /backoffice/sales/export — CSV de todas las ventas que coinciden
   * con los filtros. Declared before `sales/:id` so "export" is not
   * captured as an id.
   */
  @Get('sales/export')
  @Roles(RoleType.ADMIN)
  async exportSales(
    @CurrentUser() user: User,
    @Query() query: SalesQueryParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const csv = await this.salesOverview.getSalesCsv(
      user,
      toSalesFilterQuery(query),
    );
    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ventas-${this.csvBuilder.exportFileStamp()}.csv"`,
    });
    return csv;
  }

  /**
   * GET /backoffice/sales/:id — detalle de una venta con sus líneas.
   */
  @Get('sales/:id')
  @Roles(RoleType.ADMIN)
  getSaleDetail(@CurrentUser() user: User, @Param('id') saleId: string) {
    return this.salesOverview.getSaleDetail(user, saleId);
  }
}
