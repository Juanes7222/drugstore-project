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
import { CashShiftService } from './cash-shift.service';
import { CreateCashShiftDto } from './dto/create-cash-shift.dto';
import { UpdateCashShiftDto } from './dto/update-cash-shift.dto';
import { QueryCashShiftDto } from './dto/query-cash-shift.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CreateCashShiftSchema } from './dto/create-cash-shift.schema';

@Controller('cash-shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashShiftController {
  constructor(private cashShiftService: CashShiftService) {}

  @Get()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findAll(@Query() query: QueryCashShiftDto): Promise<any> {
    return this.cashShiftService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.cashShiftService.findById(id);
  }

  @Post()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CASH_SHIFT,
    entityType: 'CashShift',
  })
  async create(
    @Body(new ZodValidationPipe(CreateCashShiftSchema))
    createDto: CreateCashShiftDto,
  ): Promise<any> {
    return this.cashShiftService.create(createDto);
  }

  @Patch(':id')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CASH_SHIFT,
    entityType: 'CashShift',
  })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateCashShiftDto,
  ): Promise<any> {
    return this.cashShiftService.update(id, updateDto);
  }

  @Post(':id/close')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CASH_SHIFT,
    entityType: 'CashShift',
  })
  async close(@Param('id') id: string): Promise<any> {
    return this.cashShiftService.close(id);
  }
}
