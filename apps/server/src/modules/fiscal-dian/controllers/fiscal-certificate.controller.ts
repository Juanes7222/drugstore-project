import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
import { FiscalCertificateService } from '../services/fiscal-certificate.service';
import { UploadFiscalCertificateSchema } from '../dto/upload-fiscal-certificate.dto';
import { UploadFiscalCertificateDto } from '../dto/upload-fiscal-certificate.dto';

@Controller('fiscal-dian/certificates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalCertificateController {
  constructor(private readonly service: FiscalCertificateService) {}

  @Get()
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  async findAll(): Promise<unknown[]> {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.service.findById(id);
  }

  @Post()
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalCertificate',
  })
  async upload(
    @Body(new ZodValidationPipe(UploadFiscalCertificateSchema))
    dto: UploadFiscalCertificateDto,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.service.upload(dto, user.id);
  }

  @Post(':id/revoke')
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalCertificate',
  })
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.service.revoke(id);
  }
}
