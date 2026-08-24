/**
 * Backoffice dashboard controller — global daily KPIs for the admin panel's
 * first screen.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RoleType, User } from '@pharmacy/shared-types';
import { DashboardService } from '../services/dashboard.service';

// Local query schema — promotion candidate for @pharmacy/shared-validation
// once the backoffice frontend consumes the period selector.
const DashboardQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d']).default('today'),
});

type DashboardQueryDto = z.infer<typeof DashboardQuerySchema>;

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * GET /backoffice/dashboard — KPIs for a selectable period (`today` by
   * default, or the last 7/30 days): sales with previous-window comparison,
   * cash shifts, inventory, fiscal, sync and users of the tenant.
   */
  @Get('dashboard')
  @Roles(RoleType.ADMIN)
  getDashboard(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(DashboardQuerySchema))
    query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDashboard(user, query.period);
  }
}
