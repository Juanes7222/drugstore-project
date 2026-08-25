import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  Body,
} from '@nestjs/common';
import { FiscalResolutionsService } from '../services/fiscal-resolutions.service';
import { FiscalResolutionSyncService } from '../services/fiscal-resolution-sync.service';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';
import { CreateFiscalResolutionSchema } from '../dto/create-fiscal-resolution.schema';
import { SyncResolutionsFromDianDto } from '../dto/sync-resolutions-from-dian.dto';
import { SyncResolutionsFromDianSchema } from '../dto/sync-resolutions-from-dian.schema';
import { QueryFiscalResolutionsDto } from '../dto/query-fiscal-resolutions.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { AuditAction, SystemModule, RoleType, type User } from '@pharmacy/shared-types';

@Controller('fiscal-dian/resolutions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalResolutionsController {
  constructor(
    private readonly service: FiscalResolutionsService,
    private readonly syncService: FiscalResolutionSyncService,
  ) {}

  @Get()
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  async findAll(@Query() query: QueryFiscalResolutionsDto): Promise<any> {
    return this.service.findAll(query);
  }

  /**
   * Triggers the standalone DIAN numbering-range query for this tenant.
   * Idempotent: re-running never duplicates resolutions; the response only
   * carries the job id — poll the GET below until APPLIED or FAILED.
   */
  @Post('sync-from-dian')
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  @HttpCode(202)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalResolutionSyncJob',
  })
  async syncFromDian(
    @Body(new ZodValidationPipe(SyncResolutionsFromDianSchema))
    dto: SyncResolutionsFromDianDto,
    @CurrentUser() user: User,
  ): Promise<{ syncJobId: string }> {
    return this.syncService.startSync(dto, user?.id ?? null);
  }

  /**
   * Polls a numbering-range sync job. When the fiscal engine has fetched the
   * ranges, this applies them (idempotently) and returns what was created,
   * skipped, and allocated. A range conflict surfaces as HTTP 409.
   *
   * Audited as STATE_CHANGE because polling is the step that writes the
   * fetched ranges into the resolution catalog.
   */
  @Get('sync-from-dian/:jobId')
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalResolution',
  })
  async syncStatus(@Param('jobId') jobId: string): Promise<any> {
    return this.syncService.getSyncStatus(jobId);
  }

  @Get(':id')
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  async findById(@Param('id') id: string): Promise<any> {
    return this.service.findById(id);
  }

  @Post()
  @Roles(RoleType.ADMIN, RoleType.OWNER)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalResolution',
  })
  async create(
    @Body(new ZodValidationPipe(CreateFiscalResolutionSchema))
    dto: CreateFiscalResolutionDto,
  ): Promise<any> {
    return this.service.create(dto);
  }
}
