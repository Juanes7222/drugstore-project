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
import { LotsService } from '../services/lots.service';
import { QueryLotDto } from '../dto/query-lot.dto';
import { BlockLotDto, BlockLotSchema } from '../dto/block-lot.dto';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller("inventory-lots/lots")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LotsController {
  constructor(private lotsService: LotsService) {}

  // Read endpoints intentionally exclude CASHIER: lot data is inventory
  // management data, and the POS sale flow works from its local catalog
  // cache (pushed through /sync/batch), not from direct lot reads. The set
  // mirrors the POS desktop's INVENTORY_ROLES screen gate.
  @Get('sync')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.ADMIN)
  async syncLots(
    @Query('updatedSince') updatedSince?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<any> {
    return this.lotsService.findSync({
      updatedSince,
      cursor: cursor ?? null,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 500) : 200,
    });
  }

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.ADMIN)
  async findAll(@Query() query: QueryLotDto): Promise<any> {
    return this.lotsService.findAll(query);
  }

  @Get(":id")
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.ADMIN)
  async findById(@Param("id") id: string): Promise<any> {
    return this.lotsService.findById(id);
  }

  @Post(":id/block")
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.STATE_CHANGE, module: SystemModule.INVENTORY, entityType: "Lot" })
  async blockLot(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(BlockLotSchema)) dto: BlockLotDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.lotsService.blockLot(id, dto, user.id);
  }

  @Post(":id/unblock")
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.STATE_CHANGE, module: SystemModule.INVENTORY, entityType: "Lot" })
  async unblockLot(
    @Param("id") id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.lotsService.unblockLot(id, user.id);
  }

  @Get("movements")
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.ADMIN)
  async listMovements(@Query() query: QueryInventoryMovementDto): Promise<any> {
    return this.lotsService.listMovements(query);
  }
}
