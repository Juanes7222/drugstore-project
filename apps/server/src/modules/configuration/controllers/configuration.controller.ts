import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ConfigurationService } from '../services/configuration.service';
import { UpsertSystemConfigDto } from '../dto/upsert-system-config.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UpsertSystemConfigSchema } from '../dto/system-config-value.schema';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';

@Controller('configuration')
export class ConfigurationController {
  constructor(private configurationService: ConfigurationService) {}

  /**
   * Returns all system configuration entries. Sensitive values are masked for
   * non-ADMIN callers.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@CurrentUser() user: User): Promise<any> {
    return this.configurationService.findAll(user);
  }

  /**
   * Returns a single configuration entry by key. Sensitive values are masked
   * for non-ADMIN callers. Returns 404 when the key does not exist.
   */
  @Get(':key')
  @UseGuards(JwtAuthGuard)
  async findByKey(
    @Param('key') key: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    const config = await this.configurationService.findByKey(key, user);
    if (!config) {
      throw new NotFoundException(`Configuration key "${key}" not found`);
    }
    return config;
  }

  /**
   * Creates or updates a configuration entry. Only ADMIN may mutate config.
   * Identity fields (module, valueType) are immutable once set; see the
   * service for the full upsert rules.
   */
  @Patch(':key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'SystemConfig',
  })
  async upsertByKey(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpsertSystemConfigSchema))
    upsertDto: UpsertSystemConfigDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.configurationService.upsertByKey(key, upsertDto, user);
  }
}
