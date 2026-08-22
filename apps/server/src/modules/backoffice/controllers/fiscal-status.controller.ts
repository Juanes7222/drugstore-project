/**
 * Backoffice fiscal-status controller — DIAN document counts by state and
 * recent rejections.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import { FiscalStatusService } from '../services/fiscal-status.service';

interface FiscalStatusQueryParams {
  from?: string;
}

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalStatusController {
  constructor(private readonly fiscalStatus: FiscalStatusService) {}

  /**
   * GET /backoffice/fiscal-status — documentos DIAN agrupados por estado
   * (opcional: desde una fecha) y los rechazos más recientes.
   */
  @Get('fiscal-status')
  @Roles(RoleType.ADMIN)
  getStatus(
    @CurrentUser() user: User,
    @Query() query: FiscalStatusQueryParams,
  ) {
    return this.fiscalStatus.getStatus(user, query.from);
  }
}
