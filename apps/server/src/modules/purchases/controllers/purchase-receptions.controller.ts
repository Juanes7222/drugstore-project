import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  Headers,
} from '@nestjs/common';
import { PurchaseReceptionsService } from '../services/purchase-receptions.service';
import { CreatePurchaseReceptionDto, CreatePurchaseReceptionSchema } from '../dto/create-purchase-reception.dto';
import { QueryPurchaseReceptionDto } from '../dto/query-purchase-reception.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('purchases/receptions')
export class PurchaseReceptionsController {
  constructor(private purchaseReceptionsService: PurchaseReceptionsService) {}

  @Get('sync')
  @UseGuards(SyncAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async sync(
    @Query('updatedSince') updatedSince?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<any> {
    return this.purchaseReceptionsService.findSync({
      updatedSince,
      cursor: cursor ?? null,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 500) : 200,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryPurchaseReceptionDto): Promise<any> {
    return this.purchaseReceptionsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.purchaseReceptionsService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({ action: AuditAction.CREATE, module: SystemModule.PURCHASES, entityType: 'PurchaseReception' })
  async create(
    @Body(new ZodValidationPipe(CreatePurchaseReceptionSchema)) createDto: CreatePurchaseReceptionDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.purchaseReceptionsService.create(createDto, user.id);
  }

  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.PURCHASES, entityType: 'PurchaseReception' })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Headers('x-workstation-id') workstationId?: string,
  ): Promise<any> {
    return this.purchaseReceptionsService.confirm(id, user.id, workstationId || '');
  }

  @Post(':id/annul')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.PURCHASES, entityType: 'PurchaseReception' })
  async annul(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.purchaseReceptionsService.annul(id, user.id);
  }
}
