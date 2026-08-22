/**
 * Backoffice sessions controller — active sessions across the tenant.
 * Read-only: revocation is owned by auth (users/:id/sessions/:sessionId).
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import {
  SessionsOverviewQuery,
  SessionOverviewService,
} from '../services/session-overview.service';

interface SessionsQueryParams {
  page?: string;
  pageSize?: string;
}

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionsController {
  constructor(private readonly sessionOverview: SessionOverviewService) {}

  /**
   * GET /backoffice/sessions — sesiones activas del tenant con contexto de
   * usuario y terminal.
   */
  @Get('sessions')
  @Roles(RoleType.ADMIN)
  getActiveSessions(
    @CurrentUser() user: User,
    @Query() query: SessionsQueryParams,
  ) {
    const parsed: SessionsOverviewQuery = {
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.sessionOverview.getActiveSessions(user, parsed);
  }
}
