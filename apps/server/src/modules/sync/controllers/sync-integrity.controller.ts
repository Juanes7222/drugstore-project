/**
 * Sync integrity endpoints — ledger verification and admin remediation.
 *
 * POST /sync/integrity/verify    POS reports its local ledger; server diffs.
 * GET  /sync/integrity/report    Server-side integrity view (gaps, failures).
 * POST /sync/queue/requeue       Re-run failed operations instead of dropping them.
 */
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RoleType, AuditAction, SystemModule } from '@pharmacy/shared-types';
import { SyncIntegrityService } from '../services/sync-integrity.service';
import { SyncRequeueService } from '../services/sync-requeue.service';
import {
  LedgerVerifyRequestSchema,
  LedgerVerifyRequestDto,
} from '../dto/ledger-verify.dto';
import {
  RequeueOperationsSchema,
  RequeueOperationsDto,
} from '../dto/requeue-operations.dto';

@ApiTags('sync-integrity')
@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SyncIntegrityController {
  constructor(
    private readonly integrityService: SyncIntegrityService,
    private readonly requeueService: SyncRequeueService,
  ) {}

  /**
   * Callable by any authenticated POS user (typically CASHIER): it is the
   * automatic post-reconnect check, not an admin action.
   */
  @Post('integrity/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify the POS local sync ledger against the server' })
  async verifyLedger(
    @Body(new ZodValidationPipe(LedgerVerifyRequestSchema))
    dto: LedgerVerifyRequestDto,
  ): Promise<unknown> {
    return this.integrityService.verifyLedger(dto);
  }

  @Get('integrity/report')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a server-side sync integrity report' })
  async getReport(
    @Query('workstationId') workstationId?: string,
  ): Promise<unknown> {
    return this.integrityService.getReport(workstationId || undefined);
  }

  @Post('queue/requeue')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.SYNC,
    entityType: 'SyncQueue',
  })
  @ApiOperation({ summary: 'Requeue failed sync operations for replay' })
  async requeue(
    @Body(new ZodValidationPipe(RequeueOperationsSchema))
    dto: RequeueOperationsDto,
  ): Promise<unknown> {
    return this.requeueService.requeue(dto.operationUuids);
  }
}
