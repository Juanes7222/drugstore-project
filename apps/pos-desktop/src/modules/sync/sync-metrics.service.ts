/**
 * Read-only local metrics aggregator for the sync subsystem.
 *
 * Exposes queue counts, failure breakdowns, paginated permanent-failure
 * entries, and a health timeline (bucketed COMPLETED vs non-COMPLETED per
 * hour). All methods read directly from the local Prisma client with no
 * network calls and no caching beyond what the query engine already does.
 *
 * All methods are safe to call when offline — they never reach the network.
 */

import type { PrismaClient } from '@pharmacy/database/local';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface QueueCounts {
  pending: number;
  failed: number;
  permanentFailure: number;
  completed24h: number;
  completedTotal: number;
}

export interface FailureBreakdownEntry {
  category: string;
  count: number;
  mostRecent: string | null; // ISO string of lastAttemptAt
}

export interface PermanentFailureEntry {
  id: string;
  operationType: string;
  operationUuid: string;
  payloadHash: string;
  failureCategory: string | null;
  lastErrorMessage: string | null;
  retryCount: number;
  sourceCreatedAt: string;
  lastAttemptAt: string | null;
  payloadPreview: string;
}

export interface HealthTimelineBucket {
  /** ISO hour boundary, e.g. "2026-07-08T14:00:00.000Z" */
  id: string;
  completed: number;
  nonCompleted: number;
}

export interface PaginatedEntries<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  /** Cursor for the next page. null when on the last page. */
  cursor: string | null;
}

export interface SyncMetricsService {
  getQueueCounts(): Promise<QueueCounts>;
  getFailureBreakdown(since: Date): Promise<FailureBreakdownEntry[]>;
  getPermanentFailureEntries(
    opts: { limit?: number; cursor?: string },
  ): Promise<PaginatedEntries<PermanentFailureEntry>>;
  getSyncHealthTimeline(hours: number): Promise<HealthTimelineBucket[]>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const createSyncMetricsService = (
  prisma: PrismaClient,
): SyncMetricsService => {
  return new SyncMetricsServiceImpl(prisma);
};

class SyncMetricsServiceImpl implements SyncMetricsService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Return aggregate queue counts.
   *
   * On a fresh install (empty database), all values are zero.
   * The success rate caller computes `completed24h / (completed24h + failed + permanentFailure)`
   * externally to avoid division-by-zero.
   */
  async getQueueCounts(): Promise<QueueCounts> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [pending, failed, permanentFailure, completed24h, completedTotal] =
      await Promise.all([
        this.prisma.syncQueue.count({ where: { status: 'PENDING' } }),
        this.prisma.syncQueue.count({ where: { status: 'FAILED' } }),
        this.prisma.syncQueue.count({
          where: { status: 'PERMANENT_FAILURE' },
        }),
        this.prisma.syncQueue.count({
          where: {
            status: 'COMPLETED',
            lastAttemptAt: { gte: twentyFourHoursAgo },
          },
        }),
        this.prisma.syncQueue.count({ where: { status: 'COMPLETED' } }),
      ]);

    return { pending, failed, permanentFailure, completed24h, completedTotal };
  }

  /**
   * Get failure breakdown grouped by failureCategory.
   *
   * Returns entries sorted by count descending. Returns empty array when there
   * are no failures in the given window.
   */
  async getFailureBreakdown(
    since: Date,
  ): Promise<FailureBreakdownEntry[]> {
    const failures = await this.prisma.syncQueue.findMany({
      where: {
        status: { in: ['FAILED', 'PERMANENT_FAILURE'] },
        lastAttemptAt: { gte: since },
        failureCategory: { not: null },
      },
      select: {
        failureCategory: true,
        lastAttemptAt: true,
      },
      orderBy: { lastAttemptAt: 'desc' as const },
    });

    const grouped = new Map<
      string,
      { count: number; mostRecent: Date | null }
    >();

    for (const f of failures) {
      const cat = String(f.failureCategory ?? 'UNKNOWN');
      const existing = grouped.get(cat) ?? { count: 0, mostRecent: null };
      existing.count++;
      if (
        f.lastAttemptAt &&
        (!existing.mostRecent || f.lastAttemptAt > existing.mostRecent)
      ) {
        existing.mostRecent = f.lastAttemptAt;
      }
      grouped.set(cat, existing);
    }

    return Array.from(grouped.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        mostRecent: data.mostRecent?.toISOString() ?? null,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get paginated PERMANENT_FAILURE entries, newest first by lastAttemptAt.
   *
   * Each entry includes a `payloadPreview` — the first 200 characters of the
   * serialised payload JSON. Cursor-based pagination uses the entry `id`.
   * Returns `hasMore: false` and `cursor: null` on the last page.
   */
  async getPermanentFailureEntries(
    opts: { limit?: number; cursor?: string },
  ): Promise<PaginatedEntries<PermanentFailureEntry>> {
    const limit = opts.limit ?? 20;
    const cursor = opts.cursor;

    const where: Record<string, unknown> = {
      status: 'PERMANENT_FAILURE',
    };

    const entries = await this.prisma.syncQueue.findMany({
      where,
      orderBy: { lastAttemptAt: 'desc' as const },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > limit;
    const data = entries.slice(0, limit).map((entry) => ({
      id: entry.id,
      operationType: entry.operationType,
      operationUuid: entry.operationUuid,
      payloadHash: entry.payloadHash,
      failureCategory: entry.failureCategory ?? null,
      lastErrorMessage: entry.lastErrorMessage ?? null,
      retryCount: entry.retryCount,
      sourceCreatedAt: entry.sourceCreatedAt.toISOString(),
      lastAttemptAt: entry.lastAttemptAt?.toISOString() ?? null,
      payloadPreview: this.extractPayloadPreview(
        entry.payload,
        entry.operationType,
      ),
    }));

    const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

    return {
      data,
      total: await this.prisma.syncQueue.count({ where }),
      hasMore,
      cursor: nextCursor,
    };
  }

  /**
   * Get a bucketed timeline of COMPLETED vs non-COMPLETED transitions.
   *
   * Returns one bucket per hour for the last `hours` hours. Uses
   * `lastAttemptAt` as the transition timestamp. Empty hours (no data)
   * are included with zero counts so the frontend can render a continuous
   * sparkline without gap-filling.
   */
  async getSyncHealthTimeline(
    hours: number,
  ): Promise<HealthTimelineBucket[]> {
    const now = new Date();
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000);

    // Round `since` down to the nearest hour
    since.setMinutes(0, 0, 0);

    const entries = await this.prisma.syncQueue.findMany({
      where: {
        lastAttemptAt: { gte: since, not: null },
      },
      select: {
        status: true,
        lastAttemptAt: true,
      },
    });

    // Build hourly buckets
    const bucketMap = new Map<
      string,
      { completed: number; nonCompleted: number }
    >();

    // Initialise all hour buckets
    for (let i = 0; i < hours; i++) {
      const bucketDate = new Date(since.getTime() + i * 60 * 60 * 1000);
      const key = bucketDate.toISOString();
      bucketMap.set(key, { completed: 0, nonCompleted: 0 });
    }

    // Populate buckets
    for (const entry of entries) {
      if (!entry.lastAttemptAt) continue;
      // Round timestamp to hour
      const bucketDate = new Date(entry.lastAttemptAt);
      bucketDate.setMinutes(0, 0, 0);
      const key = bucketDate.toISOString();

      if (!bucketMap.has(key)) continue; // Outside window

      const bucket = bucketMap.get(key)!;
      if (entry.status === 'COMPLETED') {
        bucket.completed++;
      } else if (
        entry.status === 'FAILED' ||
        entry.status === 'PERMANENT_FAILURE'
      ) {
        bucket.nonCompleted++;
      }
    }

    return Array.from(bucketMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, data]) => ({
        id,
        completed: data.completed,
        nonCompleted: data.nonCompleted,
      }));
  }

  /**
   * Extract a human-readable preview of the payload for display in the
   * entries table. Shows the first 200 characters of the parsed JSON, or
   * operation-type-specific key fields.
   */
  private extractPayloadPreview(
    payloadJson: string,
    operationType: string,
  ): string {
    try {
      const parsed = JSON.parse(payloadJson) as Record<string, unknown>;

      // Operation-specific key fields
      if (
        operationType === 'SALE_CONFIRMATION' &&
        typeof parsed.metadata === 'object' &&
        parsed.metadata !== null
      ) {
        const meta = parsed.metadata as Record<string, unknown>;
        return `Sale #${String(meta.localNumber ?? '?')}`;
      }

      if (operationType === 'CLIENT_RETURN') {
        return `Return receipt #${String(
          parsed.receiptNumber ?? parsed.sequentialNumber ?? '?',
        )}`;
      }

      if (operationType === 'INVENTORY_ADJUSTMENT') {
        return `Adjustment lotId: ${String(
          parsed.lotId ?? parsed.adjustmentId ?? '?',
        )}`;
      }

      // Fallback: first 200 chars
      const formatted = JSON.stringify(parsed);
      return formatted.length > 200
        ? `${formatted.slice(0, 200)}…`
        : formatted;
    } catch {
      return '(unparseable payload)';
    }
  }
}