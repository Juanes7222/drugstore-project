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
import { SyncService } from '../services/sync.service';
import { SyncHealthService } from '../services/sync-health.service';
import { InvoiceTransmissionResultService } from '../services/invoice-transmission-result.service';
import { SyncBatchDto } from '../dto/sync-batch.dto';
import { SyncOperationInput } from '../dto/sync-operation.schema';
import { QuerySyncQueueDto } from '../dto/query-sync-queue.dto';
import { InvoiceResultsQuerySchema } from '../dto/invoice-results-query.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { SyncBatchSchema } from '../dto/sync-operation.schema';
import { LocalNumberHintQuerySchema } from '../dto/local-number-hint-query.dto';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';

@Controller('sync')
export class SyncController {
  constructor(
    private syncService: SyncService,
    private syncHealthService: SyncHealthService,
    private invoiceTransmissionResultService: InvoiceTransmissionResultService,
  ) {}

  /**
   * Receives a batch of offline operations.
   * Body is a JSON array of operations (no wrapper object).
   * Each operation is validated against SyncOperationSchema.
   */
  @Post('batch')
  @UseGuards(JwtAuthGuard)
  @HttpCode(202)
  async receiveBatch(
    @Body(new ZodValidationPipe(SyncBatchSchema))
    operations: SyncOperationInput[],
    @CurrentUser() user: User,
  ): Promise<any> {
    const sourceWorkstationId = (user as any).lastLoginWorkstationId ?? '';
    return this.syncService.receiveBatch(
      new SyncBatchDto(operations),
      sourceWorkstationId,
    );
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@CurrentUser() user: User): Promise<any> {
    const sourceWorkstationId = (user as any).lastLoginWorkstationId ?? '';
    return this.syncService.getStatus(sourceWorkstationId);
  }

  @Get('queue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async findAllQueue(@Query() query: QuerySyncQueueDto): Promise<any> {
    return this.syncService.findAll(query);
  }

  @Get('queue/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async findQueueById(@Param('id') id: string): Promise<any> {
    return this.syncService.findOne(id);
  }

  @Post('queue/:id/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.SYNC,
    entityType: 'SyncQueue',
  })
  async retryQueueEntry(@Param('id') id: string): Promise<any> {
    return this.syncService.retry(id);
  }

  @Get('health')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async getHealth(): Promise<any> {
    return this.syncHealthService.getHealth(24);
  }

  /**
   * Returns sync operation source statistics for admin monitoring.
   *
   * Provides DIRECT vs LOCAL_HUB breakdowns across 24h, 7d, and 30d windows,
   * a per-workstation breakdown for the last 24 hours, and the 50 most recent
   * hub relay events.
   */
  @Get('source-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async getSourceStats(): Promise<any> {
    return this.syncHealthService.getSourceStats();
  }

  @Get('local-number-hint')
  @UseGuards(JwtAuthGuard)
  async getLocalNumberHint(
    @Query(new ZodValidationPipe(LocalNumberHintQuerySchema))
    query: { workstationId: string },
  ): Promise<{ workstationId: string; maxLocalNumber: number | null }> {
    const maxLocalNumber = await this.syncService.getMaxClientSequence(
      query.workstationId,
    );
    return { workstationId: query.workstationId, maxLocalNumber };
  }

  /**
   * Returns DIAN transmission results for offline-generated (contingency)
   * invoices. Workstations poll this endpoint after reconnecting to retrieve
   * the official CUFE, DIAN XML, and acceptance status for each invoice
   * they created while offline.
   *
   * Query parameters:
   * - workstationId (required): the workstation requesting its results.
   * - since (optional, ISO-8601): return only results created after this time.
   *   If omitted, defaults to the last 24 hours.
   *
   * Results are ordered by createdAt ascending (oldest first).
   */
  @Get('invoice-results')
  // Note: uses the same JWT auth as other sync endpoints so the workstation
  // authenticates with its user's session token, same as POST /sync/batch.
  @UseGuards(JwtAuthGuard)
  async getInvoiceResults(
    @Query(new ZodValidationPipe(InvoiceResultsQuerySchema))
    query: { workstationId: string; since?: string },
  ): Promise<Array<{
    id: string;
    invoiceId: string;
    workstationId: string;
    status: string;
    cufeOfficial: string | null;
    dianXml: string | null;
    rejectionReason: string | null;
    authorizedAt: Date | null;
    createdAt: Date;
  }>> {
    const since = query.since ? new Date(query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.invoiceTransmissionResultService.findResultsForWorkstation(
      query.workstationId,
      since,
    );
  }
}
