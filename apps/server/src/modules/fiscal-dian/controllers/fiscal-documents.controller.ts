import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { FiscalDocumentsService } from '../services/fiscal-documents.service';
import { QueryFiscalDocumentsDto } from '../dto/query-fiscal-documents.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';

@Controller('fiscal-dian/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalDocumentsController {
  constructor(private fiscalDocumentsService: FiscalDocumentsService) {}

  @Get()
  @Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryFiscalDocumentsDto): Promise<any> {
    return this.fiscalDocumentsService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.fiscalDocumentsService.findById(id);
  }

  @Get(':id/xml')
  @Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
  async getXmlPayload(@Param('id') id: string): Promise<any> {
    return this.fiscalDocumentsService.getXmlPayload(id);
  }

  @Post(':id/retry')
  @Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalDocument',
  })
  async retryDocument(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<{ id: string }> {
    // The caller's workstationId is needed when retrying a REJECTED document
    // associated with a PurchaseReception (which has no workstationId of its
    // own).  For Sale and ClientReturn, the creation methods use the source's
    // own workstationId internally.
    const result = await this.fiscalDocumentsService.retry(
      id,
      (user as any).workstationId,
    );
    // Commit-then-enqueue: only push the job after the transaction commits.
    await this.fiscalDocumentsService.enqueueGenerationJob(result.id);
    return result;
  }
}
