/**
 * WorkstationHeartbeat service — receives periodic health reports from hubs.
 *
 * The hub aggregates heartbeats from all workstations in its local network
 * and POSTs them in a batch to the server. The server stores the latest
 * heartbeat per workstation for health dashboards and stale-workstation
 * detection.
 *
 * A workstation is considered "stale" when its most recent heartbeat is
 * older than STALE_THRESHOLD_MS.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes without heartbeat = stale

export interface HeartbeatInput {
  workstationId: string;
  friendlyName?: string;
  appVersion?: string;
  queueDepth: number;
  oldestPendingAt?: string;
  permanentFailures: number;
  diskSpaceMb?: number;
  lastLanSyncAt?: string;
  reportedBy: string;
}

export interface WorkstationStatus {
  workstationId: string;
  friendlyName: string | null;
  appVersion: string | null;
  queueDepth: number;
  permanentFailures: number;
  diskSpaceMb: number | null;
  lastLanSyncAt: Date | null;
  lastHeartbeatAt: Date;
  isStale: boolean;
}

@Injectable()
export class WorkstationHeartbeatService {
  private readonly logger = new Logger(WorkstationHeartbeatService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one or more workstation heartbeats.
   *
   * Called by the hub, which sends a batch of heartbeats for all
   * workstations in its local network (including itself).
   */
  async recordHeartbeats(
    heartbeats: HeartbeatInput[],
  ): Promise<{ recorded: number }> {
    const now = new Date();

    // Batch inserts in chunks of 200. If a whole chunk fails (e.g. one
    // malformed row), fall back to per-row inserts so the rest of the
    // batch is still recorded — matching the previous per-row tolerance.
    let recorded = 0;
    for (let i = 0; i < heartbeats.length; i += 200) {
      const chunk = heartbeats.slice(i, i + 200);
      const rows = chunk.map((hb) => ({
        workstationId: hb.workstationId,
        friendlyName: hb.friendlyName ?? null,
        appVersion: hb.appVersion ?? null,
        queueDepth: hb.queueDepth,
        oldestPendingAt: hb.oldestPendingAt ? new Date(hb.oldestPendingAt) : null,
        permanentFailures: hb.permanentFailures,
        diskSpaceMb: hb.diskSpaceMb ?? null,
        lastLanSyncAt: hb.lastLanSyncAt ? new Date(hb.lastLanSyncAt) : null,
        reportedBy: hb.reportedBy,
        receivedAt: now,
      }));

      try {
        const result = await this.prisma.workstationHeartbeat.createMany({
          data: rows,
        });
        recorded += result.count;
      } catch (err) {
        for (const row of rows) {
          try {
            await this.prisma.workstationHeartbeat.create({ data: row });
            recorded += 1;
          } catch (rowErr) {
            this.logger.warn(
              `Failed to record heartbeat for ${row.workstationId}: ${rowErr instanceof Error ? rowErr.message : 'Unknown'}`,
            );
          }
        }
      }
    }

    return { recorded };
  }

  /**
   * Get the latest status for each known workstation.
   *
   * Returns the most recent heartbeat per workstation, with a `isStale`
   * flag indicating whether the heartbeat is older than the threshold.
   */
  async getWorkstationStatuses(): Promise<WorkstationStatus[]> {
    // Get the latest heartbeat per workstation using a raw subquery.
    // Prisma doesn't support DISTINCT ON directly, so we use $queryRaw.
    const latest = await this.prisma.$queryRaw<
      Array<{
        workstationId: string;
        friendlyName: string | null;
        appVersion: string | null;
        queueDepth: number;
        permanentFailures: number;
        diskSpaceMb: number | null;
        lastLanSyncAt: Date | null;
        receivedAt: Date;
      }>
    >`
      SELECT DISTINCT ON (w.workstationId)
        w.workstation_id,
        w.friendly_name,
        w.app_version,
        w.queue_depth,
        w.permanent_failures,
        w.disk_space_mb,
        w.last_lan_sync_at,
        w.received_at
      FROM workstation_heartbeat w
      ORDER BY w.workstation_id, w.received_at DESC
    `;

    const now = Date.now();

    return latest.map((row) => ({
      workstationId: row.workstationId,
      friendlyName: row.friendlyName,
      appVersion: row.appVersion,
      queueDepth: row.queueDepth,
      permanentFailures: row.permanentFailures,
      diskSpaceMb: row.diskSpaceMb,
      lastLanSyncAt: row.lastLanSyncAt,
      lastHeartbeatAt: row.receivedAt,
      isStale: now - row.receivedAt.getTime() > STALE_THRESHOLD_MS,
    }));
  }

  /**
   * Get the count of stale workstations (no heartbeat in the last 5 min).
   */
  async countStale(): Promise<number> {
    const statuses = await this.getWorkstationStatuses();
    return statuses.filter((s) => s.isStale).length;
  }

  /**
   * Delete heartbeats older than the retention period (housekeeping).
   */
  async deleteOld(retentionHours: number = 72): Promise<number> {
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
    const result = await this.prisma.workstationHeartbeat.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} old heartbeat(s)`);
    }
    return result.count;
  }
}
