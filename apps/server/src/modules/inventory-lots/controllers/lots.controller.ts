import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { LotsService } from '../services/lots.service';
import { QueryLotDto } from '../dto/query-lot.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';

@Controller('inventory-lots/lots')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LotsController {
  constructor(private lotsService: LotsService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryLotDto): Promise<any> {
    return this.lotsService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.lotsService.findById(id);
  }

  @Post(':id/block')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.INVENTORY,
    entityType: 'Lot',
  })
  async block(@Param('id') id: string): Promise<any> {
    return this.lotsService.block(id);
  }

  @Post(':id/unblock')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.INVENTORY,
    entityType: 'Lot',
  })
  async unblock(@Param('id') id: string): Promise<any> {
    return this.lotsService.unblock(id);
  }
}
