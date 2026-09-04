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
import { PosSettingsService } from '../services/pos-settings.service';
import { UpsertSystemConfigDto } from '../dto/upsert-system-config.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UpsertSystemConfigSchema } from '../dto/system-config-value.schema';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';

@Controller('configuration')
export class ConfigurationController {
  constructor(
    private configurationService: ConfigurationService,
    private posSettingsService: PosSettingsService,
  ) {}

  /**
   * Returns the structured POS settings payload.
   *
   * Dual-path auth (SyncAuthGuard) + @Public optional fallback: the POS
   * desktop fetches this without a session on first boot (public allowed,
   * RLS fails closed), but during normal sync it sends Bearer or
   * X-Offline-Token so TenantContextInterceptor binds the subscription and
   * RLS returns tenant's payment methods. Offline token path prevents 401
   * when the 15-min access token expires during offline window.
   */
  @Get('pos-settings')
  @Public()
  @UseGuards(SyncAuthGuard)
  async getPosSettings(): Promise<unknown> {
    return this.posSettingsService.getPosSettings();
  }

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
