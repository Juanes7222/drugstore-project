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

  @Get()
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryLotDto): Promise<any> {
    return this.lotsService.findAll(query);
  }

  @Get(":id")
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
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
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async listMovements(@Query() query: QueryInventoryMovementDto): Promise<any> {
    return this.lotsService.listMovements(query);
  }
}
