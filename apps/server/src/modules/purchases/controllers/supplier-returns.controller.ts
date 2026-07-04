import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { SupplierReturnsService } from '../services/supplier-returns.service';
import {
  CreateSupplierReturnDto,
  CreateSupplierReturnSchema,
} from '../dto/create-supplier-return.dto';
import { QuerySupplierReturnDto } from '../dto/query-supplier-return.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('purchases/supplier-returns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupplierReturnsController {
  constructor(private supplierReturnsService: SupplierReturnsService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QuerySupplierReturnDto): Promise<any> {
    return this.supplierReturnsService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findOne(@Param('id') id: string): Promise<any> {
    return this.supplierReturnsService.findOne(id);
  }

  @Post()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({ action: AuditAction.CREATE, module: SystemModule.PURCHASES, entityType: 'SupplierReturn' })
  async create(
    @Body(new ZodValidationPipe(CreateSupplierReturnSchema)) createDto: CreateSupplierReturnDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.supplierReturnsService.create(createDto, user.id);
  }

  @Post(':id/confirm')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.STATE_CHANGE, module: SystemModule.PURCHASES, entityType: 'SupplierReturn' })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.supplierReturnsService.confirm(id, user.id);
  }

  @Post(':id/approve')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.STATE_CHANGE, module: SystemModule.PURCHASES, entityType: 'SupplierReturn' })
  async approve(
    @Param('id') id: string,
  ): Promise<any> {
    return this.supplierReturnsService.approve(id);
  }

  @Post(':id/annul')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.STATE_CHANGE, module: SystemModule.PURCHASES, entityType: 'SupplierReturn' })
  async annul(
    @Param('id') id: string,
  ): Promise<any> {
    return this.supplierReturnsService.annul(id);
  }
}
