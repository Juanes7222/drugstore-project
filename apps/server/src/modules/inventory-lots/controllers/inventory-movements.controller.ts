import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InventoryMovementsService } from '../services/inventory-movements.service';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';

@Controller('inventory-lots/movements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryMovementsController {
  constructor(private movementsService: InventoryMovementsService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryInventoryMovementDto): Promise<any> {
    return this.movementsService.findAll(query);
  }
}
