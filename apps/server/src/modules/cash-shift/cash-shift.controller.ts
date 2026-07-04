import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { OpenCashShiftDto, OpenCashShiftSchema } from './dto/open-cash-shift.dto';
import {
  RegisterCashCountDto,
  RegisterCashCountSchema,
} from './dto/register-cash-count.dto';
import { CloseCashShiftDto, CloseCashShiftSchema } from './dto/close-cash-shift.dto';
import {
  ForceCloseCashShiftDto,
  ForceCloseCashShiftSchema,
} from './dto/force-close-cash-shift.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('cash-shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashShiftController {
  constructor(private cashShiftService: CashShiftService) {}

  @Post()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CASH_SHIFT,
    entityType: 'CashShift',
  })
  async openShift(
    @Body(new ZodValidationPipe(OpenCashShiftSchema))
    dto: OpenCashShiftDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.cashShiftService.openShift(
      user.lastLoginWorkstationId || '',
      user.id,
      dto,
    );
  }

  @Post(':id/cash-counts')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CASH_SHIFT,
    entityType: 'ShiftCashCount',
  })
  async registerCashCount(
    @Param('id') shiftId: string,
    @Body(new ZodValidationPipe(RegisterCashCountSchema))
    dto: RegisterCashCountDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.cashShiftService.registerCashCount(shiftId, user.id, dto);
  }

  @Get(':id/cash-counts')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async listCashCounts(@Param('id') shiftId: string): Promise<any> {
    return (this.cashShiftService as any).listCashCounts(shiftId);
  }

  @Post(':id/close')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.CASH_SHIFT,
    entityType: 'CashShift',
  })
  async closeShift(
    @Param('id') shiftId: string,
    @Body(new ZodValidationPipe(CloseCashShiftSchema))
    dto: CloseCashShiftDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.cashShiftService.closeShift(shiftId, user.id, dto);
  }

  @Post(':id/force-close')
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.CASH_SHIFT,
    entityType: 'CashShift',
  })
  async forceCloseShift(
    @Param('id') shiftId: string,
    @Body(new ZodValidationPipe(ForceCloseCashShiftSchema))
    dto: ForceCloseCashShiftDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.cashShiftService.forceCloseShift(shiftId, user.id, dto);
  }
}
