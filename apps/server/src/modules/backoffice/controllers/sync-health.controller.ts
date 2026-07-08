/**
 * Backoffice read-only sync health controller.
 *
 * Exposes aggregated sync health across all workstations and a paginated
 * permanent-failure listing for admin awareness.
 *
 * ⚠ IMPORTANT: Recovery actions (retry / discard) MUST happen at the
 * originating terminal. This backoffice surface is for awareness only.
 * There is no remote-retry mechanism here.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SyncHealthService } from '@/modules/sync/services/sync-health.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// DTO types
// ---------------------------------------------------------------------------

interface SyncHealthQuery {
  windowHours?: string; // string from query, parsed to number
}

interface PermanentFailuresQuery {
  since?: string;
  until?: string;
  workstationId?: string;
  page?: string;
  pageSize?: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('backoffice')
export class SyncHealthController {
  constructor(
    private readonly syncHealthService: SyncHealthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /backoffice/sync-health
   *
   * Returns the same aggregated health payload as GET /sync/health,
   * but available via the backoffice route for admin dashboards.
   */
  @Get('sync-health')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async getHealth(@Query() query: SyncHealthQuery): Promise<any> {
    const windowHours = Math.max(1, Math.min(168, Number(query.windowHours ?? 24)));
    return this.syncHealthService.getHealth(windowHours);
  }

  /**
   * GET /backoffice/permanent-failures
   *
   * Paginated listing of permanent-failure operations from the server's
   * SyncQueue, filtered by optional date range and workstation.
   *
   * The payload includes the operation type, error message, and server-side
   * timestamps. This is read-only — recovery must be performed at the
   * originating workstation.
   */
  @Get('permanent-failures')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async getPermanentFailures(
    @Query() query: PermanentFailuresQuery,
  ): Promise<any> {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {
      status: 'PERMANENT_FAILURE',
    };

    if (query.since) {
      where.receivedAt = { ...(where.receivedAt as object ?? {}), gte: new Date(query.since) };
    }
    if (query.until) {
      where.receivedAt = { ...(where.receivedAt as object ?? {}), lte: new Date(query.until) };
    }
    if (query.workstationId) {
      where.sourceWorkstationId = query.workstationId;
    }

    const [data, total] = await Promise.all([
      this.prisma.syncQueue.findMany({
        where,
        orderBy: { processedAt: 'desc' as const },
        skip,
        take: pageSize,
        select: {
          id: true,
          operationType: true,
          operationUuid: true,
          status: true,
          lastErrorMessage: true,
          retryCount: true,
          sourceWorkstationId: true,
          sourceCreatedAt: true,
          processedAt: true,
        },
      }),
      this.prisma.syncQueue.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}