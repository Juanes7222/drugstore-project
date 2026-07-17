// ---------------------------------------------------------------------------
// TenantConfigController — CRUD endpoints for per-subscription tenant config.
// Most endpoints require MANAGER+; fiscal/owner-sensitive operations require
// OWNER role.
// ---------------------------------------------------------------------------

import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import {
  RoleType,
  AuditAction,
  SystemModule,
  User,
  CustomCompanyField,
  CustomStrictnessToggle,
} from '@pharmacy/shared-types';
import { TenantConfigService } from '../services/tenant-config.service';
import { UpdateTenantConfigDto } from '../dto/update-tenant-config.dto';
import { ApplyPresetDto } from '../dto/apply-preset.dto';
import {
  AddCustomFieldDto,
  UpdateCustomFieldDto,
} from '../dto/custom-field.dto';
import {
  AddCustomToggleDto,
  UpdateCustomToggleDto,
} from '../dto/custom-toggle.dto';
import {
  UpdateTenantConfigSchema,
  ApplyPresetSchema,
  AddCustomFieldSchema,
  UpdateCustomFieldSchema,
  AddCustomToggleSchema,
  UpdateCustomToggleSchema,
} from '../dto/update-tenant-config.schema';

@Controller('tenant-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantConfigController {
  constructor(private tenantConfigService: TenantConfigService) {}

  /**
   * Returns current tenant configuration (sensitive fiscal fields stripped).
   */
  @Get()
  @Roles(RoleType.MANAGER, RoleType.OWNER)
  async getConfig(@CurrentUser() user: User): Promise<unknown> {
    return this.tenantConfigService.getBySubscription(
      user.subscriptionId ?? '',
    );
  }

  /**
   * Full config update. OWNER can update all sections; MANAGER is restricted
   * to workstation-level fields (system/fiscal/compliance fields are blocked
   * via RBAC in the service). Uses optimistic concurrency via
   * expectedConfigVersion.
   */
  @Put()
  @Roles(RoleType.MANAGER, RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'TenantConfig',
  })
  async updateConfig(
    @Body(new ZodValidationPipe(UpdateTenantConfigSchema))
    dto: UpdateTenantConfigDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.update(
      user.subscriptionId ?? '',
      dto,
      user.id,
      user.role,
    );
  }

  // -- Preset management ---------------------------------------------------

  /**
   * Applies a built-in preset (SIMPLE, BALANCED, STRICT).
   * OWNER only — resets strictness + workflow to preset values.
   */
  @Post('apply-preset')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'TenantConfig',
  })
  async applyPreset(
    @Body(new ZodValidationPipe(ApplyPresetSchema))
    dto: ApplyPresetDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.applyPreset(
      user.subscriptionId ?? '',
      dto.presetCode,
      user.id,
    );
  }

  /**
   * Resets strictness + workflow back to the currently active preset.
   */
  @Post('reset-to-preset')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'TenantConfig',
  })
  async resetToPreset(@CurrentUser() user: User): Promise<unknown> {
    return this.tenantConfigService.resetToPreset(
      user.subscriptionId ?? '',
      user.id,
    );
  }

  // -- Custom company fields -----------------------------------------------

  @Post('custom-fields')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CONFIG,
    entityType: 'CustomCompanyField',
  })
  async addCustomField(
    @Body(new ZodValidationPipe(AddCustomFieldSchema))
    dto: AddCustomFieldDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.addCustomField(
      user.subscriptionId ?? '',
      { ...dto } as unknown as CustomCompanyField,
      user.id,
    );
  }

  @Patch('custom-fields/:fieldId')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'CustomCompanyField',
  })
  async updateCustomField(
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(UpdateCustomFieldSchema))
    dto: UpdateCustomFieldDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.updateCustomField(
      user.subscriptionId ?? '',
      fieldId,
      { ...dto } as unknown as Partial<CustomCompanyField>,
      user.id,
    );
  }

  @Delete('custom-fields/:fieldId')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.DELETE,
    module: SystemModule.CONFIG,
    entityType: 'CustomCompanyField',
  })
  async removeCustomField(
    @Param('fieldId') fieldId: string,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.removeCustomField(
      user.subscriptionId ?? '',
      fieldId,
      user.id,
    );
  }

  // -- Custom strictness toggles -------------------------------------------

  @Post('custom-toggles')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CONFIG,
    entityType: 'CustomStrictnessToggle',
  })
  async addCustomToggle(
    @Body(new ZodValidationPipe(AddCustomToggleSchema))
    dto: AddCustomToggleDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.addCustomToggle(
      user.subscriptionId ?? '',
      { ...dto } as unknown as CustomStrictnessToggle,
      user.id,
    );
  }

  @Patch('custom-toggles/:toggleId')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'CustomStrictnessToggle',
  })
  async updateCustomToggle(
    @Param('toggleId') toggleId: string,
    @Body(new ZodValidationPipe(UpdateCustomToggleSchema))
    dto: UpdateCustomToggleDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.updateCustomToggle(
      user.subscriptionId ?? '',
      toggleId,
      { ...dto } as unknown as Partial<CustomStrictnessToggle>,
      user.id,
    );
  }

  @Delete('custom-toggles/:toggleId')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.DELETE,
    module: SystemModule.CONFIG,
    entityType: 'CustomStrictnessToggle',
  })
  async removeCustomToggle(
    @Param('toggleId') toggleId: string,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.removeCustomToggle(
      user.subscriptionId ?? '',
      toggleId,
      user.id,
    );
  }

  // -- History & rollback --------------------------------------------------

  @Get('history')
  @Roles(RoleType.MANAGER, RoleType.OWNER)
  async getHistory(@CurrentUser() user: User): Promise<unknown> {
    return this.tenantConfigService.getHistory(
      user.subscriptionId ?? '',
      30,
    );
  }

  @Post('rollback/:version')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'TenantConfig',
  })
  async rollback(
    @Param('version') version: string,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new NotFoundException('Invalid version number');
    }
    return this.tenantConfigService.rollback(
      user.subscriptionId ?? '',
      versionNum,
      user.id,
    );
  }

  // -- Sync endpoint -------------------------------------------------------

  /**
   * Returns config + preset definitions + workstation overrides for POS sync.
   * Accessible to any authenticated user (the POS sync agent).
   * The optional `workstationId` query parameter includes per-workstation
   * overrides in the response.
   */
  @Get('sync')
  async getSyncPayload(
    @CurrentUser() user: User,
    @Query('workstationId') workstationId?: string,
  ): Promise<unknown> {
    return this.tenantConfigService.getSyncPayload(
      user.subscriptionId ?? '',
      workstationId || (user as any).lastLoginWorkstationId,
    );
  }
}
