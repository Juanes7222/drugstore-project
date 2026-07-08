import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  Headers,
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

  /**
   * @deprecated The POS desktop no longer calls this endpoint directly.
   * Cash shift opening is now triggered through `POST /sync/batch` as a
   * `SHIFT_CLOSURE` operation flow. This endpoint is preserved **exclusively**
   * for Backoffice administrative use and manual overrides from the web interface.
   */
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
    @Headers('x-workstation-id') workstationId?: string,
  ): Promise<any> {
    return this.cashShiftService.openShift(
      workstationId || '',
      user.id,
      dto,
    );
  }

  /**
   * @deprecated The POS desktop no longer calls this endpoint directly.
   * Cash counts are registered as part of the `SHIFT_CLOSURE` sync operation
   * inside `POST /sync/batch`. This endpoint is preserved **exclusively**
   * for Backoffice administrative use and manual overrides from the web interface.
   */
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

  /**
   * @deprecated The POS desktop no longer calls this endpoint directly.
   * Shift closure is now handled through `POST /sync/batch` as a
   * `SHIFT_CLOSURE` operation. This endpoint is preserved **exclusively**
   * for Backoffice administrative use and manual overrides from the web interface.
   */
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

  /**
   * @deprecated The POS desktop no longer calls this endpoint directly.
   * Force-close is only used for Backoffice administrative overrides;
   * the POS relies entirely on `POST /sync/batch` for normal closure.
   */
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
