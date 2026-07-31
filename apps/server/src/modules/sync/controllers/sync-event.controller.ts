/**
 * SyncEvent controller — endpoints for workstation event pull and acknowledgement.
 *
 * Workstations poll GET /sync/events/pending for unacknowledged events and
 * POST /sync/events/:id/acknowledge after applying them locally.
 * Admin endpoints for creating events and viewing the event log.
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { SyncEventService } from '../services/sync-event.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { SyncAuthGuard } from '../guards/sync-auth.guard';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';

@Controller('sync/events')
export class SyncEventController {
  private readonly logger = new Logger(SyncEventController.name);

  constructor(private readonly syncEventService: SyncEventService) {}

  /**
   * Pull pending events for a workstation.
   *
   * Returns unacknowledged, non-expired events (both broadcast and
   * workstation-specific). The workstation should process and acknowledge
   * each event after applying it locally.
   *
   * Guard: SyncAuthGuard (JWT or offline token) so the workstation can
   * authenticate even with a long-lived offline token — same as POST /sync/batch.
   */
  @Get('pending')
  @UseGuards(SyncAuthGuard)
  async getPendingEvents(
    @Query('workstationId') workstationId: string,
  ): Promise<Array<{
    id: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown> | null;
    severity: string;
    createdAt: Date;
  }>> {
    return this.syncEventService.getPendingEvents(workstationId);
  }

  /**
   * Acknowledge an event after applying it locally.
   *
   * Idempotent: acknowledging an already-acknowledged event is a no-op.
   */
  @Post(':id/acknowledge')
  @UseGuards(SyncAuthGuard)
  @HttpCode(200)
  async acknowledgeEvent(
    @Param('id') eventId: string,
    @CurrentUser() user: User,
  ): Promise<{ acknowledged: boolean }> {
    const acknowledgedById = (user as any).id ?? 'unknown';
    await this.syncEventService.acknowledgeEvent(eventId, acknowledgedById);
    return { acknowledged: true };
  }

  /**
   * Admin: create a new sync event (e.g., from backoffice).
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN, RoleType.MANAGER)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.SYNC,
    entityType: 'SyncEvent',
  })
  async createEvent(
    @Body() body: {
      eventType: string;
      entityType: string;
      entityId: string;
      payload?: Record<string, unknown>;
      severity?: string;
      sourceWorkstationId?: string | null;
      ttlMinutes?: number;
    },
  ): Promise<{ id: string }> {
    return this.syncEventService.createEvent({
      eventType: body.eventType as any,
      entityType: body.entityType,
      entityId: body.entityId,
      payload: body.payload,
      severity: (body.severity as any) ?? 'INFO',
      sourceWorkstationId: body.sourceWorkstationId ?? null,
      ttlMinutes: body.ttlMinutes,
    });
  }

  /**
   * Admin: view pending event count.
   */
  @Get('count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async countPending(): Promise<{ count: number }> {
    const count = await this.syncEventService.countPending();
    return { count };
  }
}
