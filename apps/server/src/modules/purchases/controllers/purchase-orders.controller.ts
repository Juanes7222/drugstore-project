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
import { CreatePurchaseOrderDto, CreatePurchaseOrderSchema } from '../dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from '../dto/query-purchase-order.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('purchases/purchase-orders')
export class PurchaseOrdersController {
  constructor(private purchaseOrdersService: PurchaseOrdersService) {}

  @Get('sync')
  @UseGuards(SyncAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async sync(
    @Query('updatedSince') updatedSince?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<any> {
    return this.purchaseOrdersService.findSync({
      updatedSince,
      cursor: cursor ?? null,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 500) : 200,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryPurchaseOrderDto): Promise<any> {
    return this.purchaseOrdersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.purchaseOrdersService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({ action: AuditAction.CREATE, module: SystemModule.PURCHASES, entityType: 'PurchaseOrder' })
  async create(
    @Body(new ZodValidationPipe(CreatePurchaseOrderSchema)) createDto: CreatePurchaseOrderDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.purchaseOrdersService.create(createDto, user.id);
  }

  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.PURCHASES, entityType: 'PurchaseOrder' })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.purchaseOrdersService.confirm(id, user.id);
  }

  @Post(':id/annul')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.PURCHASES, entityType: 'PurchaseOrder' })
  async annul(@Param('id') id: string): Promise<any> {
    return this.purchaseOrdersService.annul(id);
  }
}
