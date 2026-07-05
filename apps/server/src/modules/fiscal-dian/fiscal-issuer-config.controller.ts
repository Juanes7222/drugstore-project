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
import { FiscalIssuerConfigService } from './fiscal-issuer-config.service';
import { UpsertFiscalIssuerConfigSchema } from './dto/upsert-fiscal-issuer-config.dto';
import { UpsertFiscalIssuerConfigDto } from './dto/upsert-fiscal-issuer-config.dto';

@Controller('fiscal-dian/issuer-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalIssuerConfigController {
  constructor(private readonly service: FiscalIssuerConfigService) {}

  @Get()
  @Roles(RoleType.ADMIN)
  async find(): Promise<any> {
    return this.service.find();
  }

  @Patch()
  @Roles(RoleType.ADMIN)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.FISCAL, entityType: 'FiscalIssuerConfig' })
  async upsert(
    @Body(new ZodValidationPipe(UpsertFiscalIssuerConfigSchema))
    dto: UpsertFiscalIssuerConfigDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.service.upsert(dto, user.id);
  }
}
