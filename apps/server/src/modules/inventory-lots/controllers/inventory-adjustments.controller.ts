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
import { InventoryAdjustmentsService } from '../services/inventory-adjustments.service';
import {
  CreateInventoryAdjustmentDto,
  CreateInventoryAdjustmentSchema,
} from '../dto/create-inventory-adjustment.dto';
import {
  ApproveInventoryAdjustmentDto,
  ApproveInventoryAdjustmentSchema,
} from '../dto/approve-inventory-adjustment.dto';
import {
  RejectInventoryAdjustmentDto,
  RejectInventoryAdjustmentSchema,
} from '../dto/reject-inventory-adjustment.dto';
import {
  AnnulInventoryAdjustmentDto,
  AnnulInventoryAdjustmentSchema,
} from '../dto/annul-inventory-adjustment.dto';
import { QueryInventoryAdjustmentDto } from '../dto/query-inventory-adjustment.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('inventory-lots/adjustments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryAdjustmentsController {
  constructor(private adjustmentsService: InventoryAdjustmentsService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryInventoryAdjustmentDto): Promise<any> {
    return this.adjustmentsService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.adjustmentsService.findById(id);
  }

  /**
   * @deprecated The POS desktop no longer calls this endpoint directly.
   * Inventory adjustments are now sent through `POST /sync/batch` as an
   * `INVENTORY_ADJUSTMENT` operation for offline-first synchronization.
   * This endpoint is preserved **exclusively** for Backoffice administrative
   * use and manual overrides from the web interface.
   */
  @Post()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.INVENTORY,
    entityType: 'InventoryAdjustmentDocument',
  })
  async create(
    @Body(new ZodValidationPipe(CreateInventoryAdjustmentSchema))
    createDto: CreateInventoryAdjustmentDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.adjustmentsService.create(createDto, user.id);
  }

  @Post(':id/submit')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'InventoryAdjustmentDocument',
  })
  async submit(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.adjustmentsService.submit(id, user.id);
  }

  @Post(':id/approve')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'InventoryAdjustmentDocument',
  })
  async approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproveInventoryAdjustmentSchema))
    approveDto: ApproveInventoryAdjustmentDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.adjustmentsService.approve(id, user.id, approveDto);
  }

  @Post(':id/reject')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'InventoryAdjustmentDocument',
  })
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectInventoryAdjustmentSchema))
    rejectDto: RejectInventoryAdjustmentDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.adjustmentsService.reject(id, user.id, rejectDto);
  }

  @Post(':id/apply')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'InventoryAdjustmentDocument',
  })
  async apply(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.adjustmentsService.apply(id, user.id);
  }

  @Post(':id/annul')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'InventoryAdjustmentDocument',
  })
  async annul(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AnnulInventoryAdjustmentSchema))
    annulDto: AnnulInventoryAdjustmentDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.adjustmentsService.annul(id, user.id, annulDto);
  }
}
