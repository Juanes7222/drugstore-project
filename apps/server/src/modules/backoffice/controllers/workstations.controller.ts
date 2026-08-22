/**
 * Backoffice workstations controller — terminal state across the tenant.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import { WorkstationOverviewService } from '../services/workstation-overview.service';

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkstationsController {
  constructor(
    private readonly workstationOverview: WorkstationOverviewService,
  ) {}

  /**
   * GET /backoffice/workstations — terminales con último seen, sesiones
   * activas y ventas de hoy.
   */
  @Get('workstations')
  @Roles(RoleType.ADMIN)
  getWorkstations(@CurrentUser() user: User) {
    return this.workstationOverview.getWorkstations(user);
  }
}
