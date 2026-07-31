/**
 * Heartbeat controller — receives workstation health reports from hubs.
 *
 * Hubs POST aggregated heartbeats for all workstations in their local
 * network. The server stores them for health dashboards and stale-
 * workstation detection. Admin endpoints for viewing workstation status.
 *
 * Guard strategy:
 * - POST /sync/heartbeat — SyncAuthGuard (JWT or offline token) so the
 *   hub can authenticate with either credential.
 * - GET /sync/heartbeat/status — JwtAuthGuard + ADMIN/MANAGER
 */
import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  WorkstationHeartbeatService,
  type HeartbeatInput,
  type WorkstationStatus,
} from '../services/workstation-heartbeat.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { SyncAuthGuard } from '../guards/sync-auth.guard';
import { RoleType } from '@pharmacy/shared-types';

@Controller('sync/heartbeat')
export class HeartbeatController {
  private readonly logger = new Logger(HeartbeatController.name);

  constructor(
    private readonly heartbeatService: WorkstationHeartbeatService,
  ) {}

  /**
   * Receive a batch of workstation heartbeats from a hub.
   *
   * Body: { workstations: HeartbeatInput[] }
   * The hub reports all workstations it knows about (including itself).
   */
  @Post()
  @UseGuards(SyncAuthGuard)
  async receiveHeartbeats(
    @Body() body: { workstations: HeartbeatInput[] },
  ): Promise<{ recorded: number }> {
    if (!body.workstations?.length) {
      return { recorded: 0 };
    }
    return this.heartbeatService.recordHeartbeats(body.workstations);
  }

  /**
   * Admin: get the latest status for all known workstations.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN, RoleType.MANAGER)
  async getWorkstationStatuses(): Promise<{
    workstations: WorkstationStatus[];
    staleCount: number;
  }> {
    const workstations = await this.heartbeatService.getWorkstationStatuses();
    const staleCount = workstations.filter((w) => w.isStale).length;
    return { workstations, staleCount };
  }
}
