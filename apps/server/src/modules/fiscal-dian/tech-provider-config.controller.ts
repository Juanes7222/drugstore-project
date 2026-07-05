import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RoleType, AuditAction, SystemModule, User } from '@pharmacy/shared-types';
import { TechProviderConfigService } from './tech-provider-config.service';
import { UpsertTechProviderConfigSchema } from './dto/upsert-tech-provider-config.dto';
import { UpsertTechProviderConfigDto } from './dto/upsert-tech-provider-config.dto';

@Controller('fiscal-dian/tech-provider-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TechProviderConfigController {
  constructor(private readonly service: TechProviderConfigService) {}

  @Get()
  @Roles(RoleType.ADMIN)
  async find(): Promise<any> {
    return this.service.find();
  }

  @Patch()
  @Roles(RoleType.ADMIN)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.FISCAL, entityType: 'TechProviderConfig' })
  async upsert(
    @Body(new ZodValidationPipe(UpsertTechProviderConfigSchema))
    dto: UpsertTechProviderConfigDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.service.upsert(dto, user.id);
  }
}
