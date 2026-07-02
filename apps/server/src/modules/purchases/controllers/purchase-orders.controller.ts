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
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from '../dto/query-purchase-order.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CreatePurchaseOrderSchema } from '../dto/create-purchase-order.schema';

@Controller('purchases/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseOrdersController {
  constructor(private purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryPurchaseOrderDto): Promise<any> {
    return this.purchaseOrdersService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.purchaseOrdersService.findById(id);
  }

  @Post()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.PURCHASES,
    entityType: 'PurchaseOrder',
  })
  async create(
    @Body(new ZodValidationPipe(CreatePurchaseOrderSchema))
    createDto: CreatePurchaseOrderDto,
  ): Promise<any> {
    return this.purchaseOrdersService.create(createDto);
  }

  @Post(':id/confirm')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.PURCHASES,
    entityType: 'PurchaseOrder',
  })
  async confirm(@Param('id') id: string): Promise<any> {
    return this.purchaseOrdersService.confirm(id);
  }
}
