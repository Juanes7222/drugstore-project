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
import { SyncBatchDto } from '../dto/sync-batch.dto';
import { QuerySyncQueueDto } from '../dto/query-sync-queue.dto';
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
  ) {}

  @Post('batch')
  @UseGuards(JwtAuthGuard)
  @HttpCode(202)
  async receiveBatch(
    @Body(new ZodValidationPipe(SyncBatchSchema))
    batchDto: SyncBatchDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    const sourceWorkstationId = (user as any).lastLoginWorkstationId ?? '';
    return this.syncService.receiveBatch(batchDto, sourceWorkstationId);
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
}
