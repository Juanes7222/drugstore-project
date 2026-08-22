/**
 * Backoffice dashboard controller — global daily KPIs for the admin panel's
 * first screen.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import { DashboardService } from '../services/dashboard.service';

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * GET /backoffice/dashboard — KPIs del día: ventas, turnos, inventario,
   * fiscal, sync y usuarios del tenant.
   */
  @Get('dashboard')
  @Roles(RoleType.ADMIN)
  getDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getDashboard(user);
  }
}
