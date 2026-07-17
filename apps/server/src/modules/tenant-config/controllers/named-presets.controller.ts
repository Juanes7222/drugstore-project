// ---------------------------------------------------------------------------
// NamedPresetsController — save, load, apply, and delete named presets.
// Named presets are full-configuration snapshots saved by the OWNER for
// reuse across workstations or locations.
// ---------------------------------------------------------------------------

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
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
} from '@pharmacy/shared-types';
import { TenantConfigService } from '../services/tenant-config.service';
import {
  CreateNamedPresetDto,
  UpdateNamedPresetDto,
} from '../dto/named-preset.dto';
import {
  CreateNamedPresetSchema,
  UpdateNamedPresetSchema,
} from '../dto/update-tenant-config.schema';

@Controller('tenant-config/named-presets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NamedPresetsController {
  constructor(private tenantConfigService: TenantConfigService) {}

  /**
   * Save the current config as a named preset.
   */
  @Post()
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CONFIG,
    entityType: 'NamedPreset',
  })
  async create(
    @Body(new ZodValidationPipe(CreateNamedPresetSchema))
    dto: CreateNamedPresetDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.saveNamedPreset(
      user.subscriptionId ?? '',
      dto.name,
      dto.description,
      dto.isShared,
      user.id,
    );
  }

  /**
   * List all named presets for the subscription (metadata only).
   */
  @Get()
  @Roles(RoleType.MANAGER, RoleType.OWNER)
  async list(@CurrentUser() user: User): Promise<unknown> {
    return this.tenantConfigService.listNamedPresets(
      user.subscriptionId ?? '',
    );
  }

  /**
   * Get a single named preset (full config).
   */
  @Get(':id')
  @Roles(RoleType.MANAGER, RoleType.OWNER)
  async get(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.getNamedPreset(
      id,
      user.subscriptionId ?? '',
    );
  }

  /**
   * Apply a named preset — replaces current config with saved snapshot.
   * Sets activePresetCode to null (Custom mode).
   */
  @Post(':id/apply')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'TenantConfig',
  })
  async apply(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.applyNamedPreset(
      id,
      user.subscriptionId ?? '',
      user.id,
    );
  }

  /**
   * Delete a named preset.
   */
  @Delete(':id')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.DELETE,
    module: SystemModule.CONFIG,
    entityType: 'NamedPreset',
  })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.tenantConfigService.deleteNamedPreset(
      id,
      user.subscriptionId ?? '',
    );
  }

  /**
   * Update a named preset's metadata (name, description, isShared).
   */
  @Patch(':id')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'NamedPreset',
  })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateNamedPresetSchema))
    dto: UpdateNamedPresetDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.tenantConfigService.updateNamedPreset(
      id,
      user.subscriptionId ?? '',
      dto,
    );
  }
}
