import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { SuppliersService } from '../services/suppliers.service';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { QuerySupplierDto } from '../dto/query-supplier.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { SupplierSchema } from '../dto/supplier.schema';

@Controller('purchases/suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QuerySupplierDto): Promise<any> {
    return this.suppliersService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.suppliersService.findById(id);
  }

  @Post()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.PURCHASES,
    entityType: 'Supplier',
  })
  async create(
    @Body(new ZodValidationPipe(SupplierSchema))
    createDto: CreateSupplierDto,
  ): Promise<any> {
    return this.suppliersService.create(createDto);
  }

  @Patch(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.PURCHASES,
    entityType: 'Supplier',
  })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateSupplierDto,
  ): Promise<any> {
    return this.suppliersService.update(id, updateDto);
  }
}
