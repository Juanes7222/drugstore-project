/**
 * Sync health aggregation service.
 *
 * Provides aggregate counts across all workstations for the last 24 hours,
 * read from the server's SyncOperationOutcome table (the server-side source
 * of truth for per-operation outcomes).
 *
 * Clock-skew note
 * ---------------
 * The "oldest pending age" metric is computed from server-side timestamps
 * (createdAt in SyncOperationOutcome), not from the POS sourceCreatedAt.
 * This avoids cross-terminal clock-skew bugs.
 *
 * Window
 * ------
 * Default aggregation window is the last 24 hours (1440 minutes).
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthResponse {
  windowHours: number;
  perWorkstation: WorkstationHealth[];
  totals: HealthTotals;
  topFailureCategories: FailureCategoryCount[];
}

export interface WorkstationHealth {
  workstationId: string;
  completed: number;
  rejected: number;
  permanentFailure: number;
  /** Age in seconds of the oldest PENDING operation, null if none. */
  oldestPendingAgeSeconds: number | null;
}

export interface HealthTotals {
  completed: number;
  rejected: number;
  permanentFailure: number;
  pending: number;
}

export interface FailureCategoryCount {
  category: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SyncHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get aggregated sync health data across all workstations.
   *
   * @param windowHours  How many hours back to look (default: 24).
   *
   * JSDoc: The "oldest pending age" is computed from server-side timestamps
   * (createdAt in SyncOperationOutcome), not from the client's sourceCreatedAt.
   */
  async getHealth(windowHours: number = 24): Promise<HealthResponse> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [
      perWorkstation,
      totals,
      topFailureCategories,
    ] = await Promise.all([
      this.computePerWorkstation(since),
      this.computeTotals(since),
      this.computeTopFailureCategories(since),
    ]);

    return {
      windowHours,
      perWorkstation,
      totals,
      topFailureCategories,
    };
  }

  /**
   * Compute per-workstation breakdown.
   * Groups outcomes by workstationId within the aggregation window.
   */
  private async computePerWorkstation(
    since: Date,
  ): Promise<WorkstationHealth[]> {
    const outcomes = await this.prisma.syncOperationOutcome.groupBy({
      by: ['workstationId', 'outcome'],
      where: { createdAt: { gte: since } },
      _count: true,
    });

    const workstationMap = new Map<
      string,
      { completed: number; rejected: number; permanentFailure: number }
    >();

    for (const row of outcomes) {
      const ws = workstationMap.get(row.workstationId) ?? {
        completed: 0,
        rejected: 0,
        permanentFailure: 0,
      };

      if (row.outcome === 'ACCEPTED' || row.outcome === 'ALREADY_ACCEPTED') {
        ws.completed += row._count;
      } else if (row.outcome === 'REJECTED') {
        ws.rejected += row._count;
      } else if (row.outcome === 'FAILED') {
        ws.permanentFailure += row._count;
      }

      workstationMap.set(row.workstationId, ws);
    }

    const workstationIds = Array.from(workstationMap.keys());

    // Compute oldest pending age per workstation (from SyncQueue, server-side)
    const oldestPendingPromises = workstationIds.map(async (id) => {
      const oldestPending = await this.prisma.syncQueue.findFirst({
        where: {
          sourceWorkstationId: id,
          status: 'PENDING',
        },
        orderBy: { receivedAt: 'asc' as const },
        select: { receivedAt: true },
      });

      let oldestPendingAgeSeconds: number | null = null;
      if (oldestPending?.receivedAt) {
        oldestPendingAgeSeconds = Math.floor(
          (Date.now() - oldestPending.receivedAt.getTime()) / 1000,
        );
      }

      return { workstationId: id, oldestPendingAgeSeconds };
    });

    const oldestPendingResults = await Promise.all(oldestPendingPromises);
    const pendingMap = new Map(
      oldestPendingResults.map((r) => [r.workstationId, r.oldestPendingAgeSeconds]),
    );

    return Array.from(workstationMap.entries())
      .map(([workstationId, counts]) => ({
        workstationId,
        ...counts,
        oldestPendingAgeSeconds: pendingMap.get(workstationId) ?? null,
      }))
      .sort((a, b) => a.workstationId.localeCompare(b.workstationId));
  }

  /**
   * Compute aggregate totals across all workstations within the window.
   */
  private async computeTotals(since: Date): Promise<HealthTotals> {
    const [completed, rejected, permanentFailure, pending] =
      await Promise.all([
        this.prisma.syncOperationOutcome.count({
          where: {
            createdAt: { gte: since },
            outcome: { in: ['ACCEPTED', 'ALREADY_ACCEPTED'] },
          },
        }),
        this.prisma.syncOperationOutcome.count({
          where: {
            createdAt: { gte: since },
            outcome: 'REJECTED',
          },
        }),
        this.prisma.syncOperationOutcome.count({
          where: {
            createdAt: { gte: since },
            outcome: 'FAILED',
          },
        }),
        this.prisma.syncQueue.count({
          where: {
            receivedAt: { gte: since },
            status: 'PENDING',
          },
        }),
      ]);

    return { completed, rejected, permanentFailure, pending };
  }

  /**
   * Compute top failure categories across all workstations within the window.
   * Sorted by count descending, limited to the top 10.
   */
  private async computeTopFailureCategories(
    since: Date,
  ): Promise<FailureCategoryCount[]> {
    const grouped = await this.prisma.syncOperationOutcome.groupBy({
      by: ['failureCategory'],
      where: {
        createdAt: { gte: since },
        outcome: 'REJECTED',
        failureCategory: { not: null },
      },
      _count: true,
      orderBy: { _count: { failureCategory: 'desc' as const } },
    });

    return grouped.slice(0, 10).map((row) => ({
      category: row.failureCategory ?? 'UNKNOWN',
      count: row._count,
    }));
  }
}