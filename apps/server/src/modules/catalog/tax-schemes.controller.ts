import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { TaxSchemesService } from './tax-schemes.service';
import { CreateTaxSchemeDto, CreateTaxSchemeSchema } from './dto/create-tax-scheme.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('tax-schemes')
export class TaxSchemesController {
  constructor(private taxSchemesService: TaxSchemesService) {}

  @Get()
  @UseGuards(SyncAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(): Promise<any> {
    return this.taxSchemesService.findAll();
  }

  @Get(':id')
  @UseGuards(SyncAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.taxSchemesService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CATALOG,
    entityType: 'TaxScheme',
  })
  async create(
    @Body(new ZodValidationPipe(CreateTaxSchemeSchema))
    dto: CreateTaxSchemeDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.taxSchemesService.create(user.id, dto);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'TaxScheme',
  })
  async deactivate(@Param('id') id: string): Promise<any> {
    return this.taxSchemesService.deactivate(id);
  }
}
