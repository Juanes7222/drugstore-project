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
import { SalesService } from '../services/sales.service';
import { CreateSaleDto } from '../dto/create-sale.dto';
import { QuerySaleDto } from '../dto/query-sale.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CreateSaleSchema } from '@pharmacy/shared-validation';

@Controller('sales-pos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findAll(@Query() query: QuerySaleDto): Promise<any> {
    return this.salesService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.salesService.findById(id);
  }

  @Post()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.SALES,
    entityType: 'Sale',
  })
  async create(
    @Body(new ZodValidationPipe(CreateSaleSchema))
    createDto: CreateSaleDto,
  ): Promise<any> {
    return this.salesService.create(createDto);
  }

  @Post(':id/confirm')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.SALES,
    entityType: 'Sale',
  })
  async confirm(@Param('id') id: string): Promise<any> {
    return this.salesService.confirm(id);
  }

  @Post(':id/annul')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.SALES,
    entityType: 'Sale',
  })
  async annul(@Param('id') id: string): Promise<any> {
    return this.salesService.annul(id);
  }
}
