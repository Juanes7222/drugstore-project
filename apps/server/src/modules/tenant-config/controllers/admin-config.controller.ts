// ---------------------------------------------------------------------------
// AdminConfigController — super-admin endpoints for cross-subscription tenant
// config inspection and force-update. SAAS_ADMIN role only.
// ---------------------------------------------------------------------------

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, AuditAction, SystemModule, User } from '@pharmacy/shared-types';
import { TenantConfigService } from '../services/tenant-config.service';

@Controller('admin/tenant-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.SAAS_ADMIN)
export class AdminConfigController {
  constructor(private tenantConfigService: TenantConfigService) {}

  /**
   * Admin view of any subscription's tenant config.
   * Does NOT strip dianTechnicalKey — only SAAS_ADMIN can see it.
   */
  @Get('subscription/:subscriptionId')
  async getBySubscription(
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<unknown> {
    return this.tenantConfigService.getRawForAdmin(subscriptionId);
  }

  /**
   * Admin force-update of arbitrary fields on a subscription's config.
   * Bypasses validation.
   */
  @Post('subscription/:subscriptionId/force-update')
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'TenantConfig',
  })
  async forceUpdate(
    @Param('subscriptionId') subscriptionId: string,
    @Body() data: Record<string, unknown>,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.forceUpdateRaw(
      subscriptionId,
      data,
      user.id,
    );
  }

  /**
   * List all built-in preset definitions.
   */
  @Get('preset-definitions')
  async getPresetDefinitions(): Promise<unknown> {
    return this.tenantConfigService.getAllPresetDefinitions();
  }
}
