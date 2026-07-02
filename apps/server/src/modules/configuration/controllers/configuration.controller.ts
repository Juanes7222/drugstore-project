import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ConfigurationService } from '../services/configuration.service';
import { UpsertSystemConfigDto } from '../dto/upsert-system-config.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UpsertSystemConfigSchema } from '../dto/system-config-value.schema';

@Controller('configuration')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.ADMIN)
export class ConfigurationController {
  constructor(private configurationService: ConfigurationService) {}

  @Get()
  async findAll(): Promise<any> {
    return this.configurationService.findAll();
  }

  @Get(':key')
  async findByKey(@Param('key') key: string): Promise<any> {
    return this.configurationService.findByKey(key);
  }

  @Patch(':key')
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'SystemConfig',
  })
  async upsertByKey(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpsertSystemConfigSchema))
    upsertDto: UpsertSystemConfigDto,
  ): Promise<any> {
    return this.configurationService.upsertByKey(key, upsertDto);
  }
}
