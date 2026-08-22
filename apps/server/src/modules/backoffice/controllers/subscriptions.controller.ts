/**
 * Backoffice subscriptions controller — platform-level view of every
 * customer subscription. SAAS_ADMIN only.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import {
  SubscriptionsOverviewQuery,
  SubscriptionOverviewService,
} from '../services/subscription-overview.service';

interface SubscriptionsQueryParams {
  page?: string;
  pageSize?: string;
}

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionOverview: SubscriptionOverviewService,
  ) {}

  /**
   * GET /backoffice/subscriptions — todas las suscripciones de clientes con
   * plan, estado y conteos de activación. Rol SAAS_ADMIN.
   */
  @Get('subscriptions')
  @Roles(RoleType.SAAS_ADMIN)
  getSubscriptions(
    @CurrentUser() user: User,
    @Query() query: SubscriptionsQueryParams,
  ) {
    const parsed: SubscriptionsOverviewQuery = {
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.subscriptionOverview.getSubscriptions(user, parsed);
  }
}
