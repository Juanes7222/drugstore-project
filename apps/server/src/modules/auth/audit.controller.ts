import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuditService, AuditEventType } from './services/audit.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { User, RoleType } from '@pharmacy/shared-types';
import { AuditLog as AuditLogModel } from '@pharmacy/database';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(RoleType.OWNER, RoleType.MANAGER, RoleType.SAAS_ADMIN)
  @ApiOperation({ summary: 'Query audit logs' })
  async queryLogs(
    @CurrentUser() _user: User,
    @Query('event') event?: string,
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('workstationId') workstationId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<{ rows: AuditLogModel[]; total: number }> {
    return this.auditService.query({
      event: (event as AuditEventType) ?? undefined,
      actorId,
      targetType,
      targetId,
      workstationId,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: limit ?? 50,
      offset: offset ?? 0,
    });
  }
}
