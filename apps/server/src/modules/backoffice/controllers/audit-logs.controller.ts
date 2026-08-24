/**
 * Backoffice audit logs controller — read-only listing of the tenant's
 * immutable audit trail. No mutations: rows are written exclusively by the
 * AuditLogInterceptor.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RoleType, User } from '@pharmacy/shared-types';
import {
  AuditAction as PrismaAuditAction,
  SystemModule as PrismaSystemModule,
} from '@pharmacy/database';
import { AuditLogOverviewService } from '../services/audit-log-overview.service';

// Local query schema — promotion candidate for @pharmacy/shared-validation
// if other audit consumers need the same filter vocabulary.
const AuditLogsQuerySchema = z.object({
  // Accepts full ISO timestamps and plain calendar dates (YYYY-MM-DD).
  from: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
  to: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
  action: z.nativeEnum(PrismaAuditAction).optional(),
  module: z.nativeEnum(PrismaSystemModule).optional(),
  userId: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

type AuditLogsQueryDto = z.infer<typeof AuditLogsQuerySchema>;

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditLogsController {
  constructor(private readonly auditLogOverview: AuditLogOverviewService) {}

  /**
   * GET /backoffice/audit-logs — newest-first audit trail for the caller's
   * tenant with date/action/module/user filters and pagination.
   */
  @Get('audit-logs')
  @Roles(RoleType.ADMIN)
  getAuditLogs(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(AuditLogsQuerySchema))
    query: AuditLogsQueryDto,
  ) {
    return this.auditLogOverview.getAuditLogs(user, query);
  }
}
