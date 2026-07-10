/**
 * Read-only local metrics aggregator for the sync subsystem.
 * All methods are offline-safe — they read from local Prisma only.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import { DomainError } from '../../common/domain-error';

// Any PENDING entry with sourceCreatedAt older than this threshold is stale.
export const STALE_PENDING_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Hard cap — exports over this limit throw instead of producing a partial file.
export const EXPORT_ROW_LIMIT = 10_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QueueCounts {
  pending: number;
  stalePending: number;
  failed: number;
  permanentFailure: number;
  completed24h: number;
  completedTotal: number;
}

export interface FailureBreakdownEntry {
  category: string;
  count: number;
  mostRecent: string | null;
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
  id: string; // ISO hour boundary, e.g. "2026-07-08T14:00:00.000Z"
  completed: number;
  nonCompleted: number;
}

export interface PaginatedEntries<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  cursor: string | null; // null when on the last page
}

/** All fields optional — omitted filters are not applied. */
export interface EntryFilter {
  status?: string;
  operationType?: string;
  failureCategory?: string;
  since?: Date;
  until?: Date;
}

export type BackupHealthLevel = 'HEALTHY' | 'STALE' | 'CRITICAL';

export interface BackupSummary {
  lastBackupAt: string | null;
  lastBackupReason: string | null;
  totalBackups: number;
  oldestBackupAt: string | null;
  totalBackupSizeBytes: number;
}

export interface FiscalSummary {
  contingencyActive: boolean;
  pendingContingencyInvoices: number;
  expiringWithin24h: number;
  expiredContingencyInvoices: number;
  transmittedLast24h: number;
  rejectedLast24h: number;
}

export interface SyncMetricsService {
  getQueueCounts(): Promise<QueueCounts>;
  getFailureBreakdown(since: Date): Promise<FailureBreakdownEntry[]>;
  getPermanentFailureEntries(
    opts: { limit?: number; cursor?: string; category?: string },
  ): Promise<PaginatedEntries<PermanentFailureEntry>>;
  getStalePendingEntries(
    opts: { limit?: number; cursor?: string },
  ): Promise<PaginatedEntries<PermanentFailureEntry>>;
  getSyncHealthTimeline(hours: number): Promise<HealthTimelineBucket[]>;
  exportEntriesAsCsv(filter: EntryFilter): Promise<string>;
  exportEntriesAsJson(filter: EntryFilter): Promise<string>;
  getBackupSummary(): Promise<BackupSummary>;
  getBackupHealth(): Promise<BackupHealthLevel>;
  getFiscalSummary(): Promise<FiscalSummary>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const createSyncMetricsService = (
  prisma: PrismaClient,
): SyncMetricsService => new SyncMetricsServiceImpl(prisma);

class SyncMetricsServiceImpl implements SyncMetricsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getQueueCounts(): Promise<QueueCounts> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const staleThreshold = new Date(now.getTime() - STALE_PENDING_THRESHOLD_MS);

    const [pending, stalePending, failed, permanentFailure, completed24h, completedTotal] =
      await Promise.all([
        this.prisma.syncQueue.count({ where: { status: 'PENDING' } }),
        this.prisma.syncQueue.count({
          where: { status: 'PENDING', sourceCreatedAt: { lt: staleThreshold } },
        }),
        this.prisma.syncQueue.count({ where: { status: 'FAILED' } }),
        this.prisma.syncQueue.count({ where: { status: 'PERMANENT_FAILURE' } }),
        this.prisma.syncQueue.count({
          where: { status: 'COMPLETED', lastAttemptAt: { gte: twentyFourHoursAgo } },
        }),
        this.prisma.syncQueue.count({ where: { status: 'COMPLETED' } }),
      ]);

    return { pending, stalePending, failed, permanentFailure, completed24h, completedTotal };
  }

  async getFailureBreakdown(since: Date): Promise<FailureBreakdownEntry[]> {
    const failures = await this.prisma.syncQueue.findMany({
      where: {
        status: { in: ['FAILED', 'PERMANENT_FAILURE'] },
        lastAttemptAt: { gte: since },
        failureCategory: { not: null },
      },
      select: { failureCategory: true, lastAttemptAt: true },
      orderBy: { lastAttemptAt: 'desc' as const },
    });

    const grouped = new Map<string, { count: number; mostRecent: Date | null }>();

    for (const f of failures) {
      const cat = String(f.failureCategory ?? 'UNKNOWN');
      const existing = grouped.get(cat) ?? { count: 0, mostRecent: null };
      existing.count++;
      if (f.lastAttemptAt && (!existing.mostRecent || f.lastAttemptAt > existing.mostRecent)) {
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

  async getPermanentFailureEntries(
    opts: { limit?: number; cursor?: string; category?: string },
  ): Promise<PaginatedEntries<PermanentFailureEntry>> {
    const limit = opts.limit ?? 20;
    const cursor = opts.cursor;
    const where: Record<string, unknown> = { status: 'PERMANENT_FAILURE' };
    if (opts.category) where.failureCategory = opts.category;

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
      payloadPreview: this.extractPayloadPreview(entry.payload, entry.operationType),
    }));

    const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

    return {
      data,
      total: await this.prisma.syncQueue.count({ where }),
      hasMore,
      cursor: nextCursor,
    };
  }

  async getStalePendingEntries(
    opts: { limit?: number; cursor?: string },
  ): Promise<PaginatedEntries<PermanentFailureEntry>> {
    const limit = opts.limit ?? 20;
    const cursor = opts.cursor;
    const staleThreshold = new Date(Date.now() - STALE_PENDING_THRESHOLD_MS);
    const where: Record<string, unknown> = { status: 'PENDING', sourceCreatedAt: { lt: staleThreshold } };

    const entries = await this.prisma.syncQueue.findMany({
      where,
      orderBy: { sourceCreatedAt: 'desc' as const },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > limit;
    const data = entries.slice(0, limit).map((entry) => ({
      id: entry.id,
      operationType: entry.operationType,
      operationUuid: entry.operationUuid,
      payloadHash: entry.payloadHash,
      failureCategory: null,
      lastErrorMessage: entry.lastErrorMessage ?? null,
      retryCount: entry.retryCount,
      sourceCreatedAt: entry.sourceCreatedAt.toISOString(),
      lastAttemptAt: entry.lastAttemptAt?.toISOString() ?? null,
      payloadPreview: this.extractPayloadPreview(entry.payload, entry.operationType),
    }));

    const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

    return {
      data,
      total: await this.prisma.syncQueue.count({ where }),
      hasMore,
      cursor: nextCursor,
    };
  }

  async getSyncHealthTimeline(hours: number): Promise<HealthTimelineBucket[]> {
    const now = new Date();
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
    since.setMinutes(0, 0, 0);

    const entries = await this.prisma.syncQueue.findMany({
      where: { lastAttemptAt: { gte: since, not: null } },
      select: { status: true, lastAttemptAt: true },
    });

    const bucketMap = new Map<string, { completed: number; nonCompleted: number }>();

    // Pre-fill every hour bucket so empty hours render as zeros (continuous sparkline).
    for (let i = 0; i < hours; i++) {
      const key = new Date(since.getTime() + i * 60 * 60 * 1000).toISOString();
      bucketMap.set(key, { completed: 0, nonCompleted: 0 });
    }

    for (const entry of entries) {
      if (!entry.lastAttemptAt) continue;
      const bucketDate = new Date(entry.lastAttemptAt);
      bucketDate.setMinutes(0, 0, 0);
      const key = bucketDate.toISOString();
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      if (entry.status === 'COMPLETED') {
        bucket.completed++;
      } else if (entry.status === 'FAILED' || entry.status === 'PERMANENT_FAILURE') {
        bucket.nonCompleted++;
      }
    }

    return Array.from(bucketMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, data]) => ({ id, completed: data.completed, nonCompleted: data.nonCompleted }));
  }

  private extractPayloadPreview(payloadJson: string, operationType: string): string {
    try {
      const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
      if (operationType === 'SALE_CONFIRMATION' && typeof parsed.metadata === 'object' && parsed.metadata !== null) {
        const meta = parsed.metadata as Record<string, unknown>;
        return `Sale #${String(meta.localNumber ?? '?')}`;
      }
      if (operationType === 'CLIENT_RETURN') {
        return `Return receipt #${String(parsed.receiptNumber ?? parsed.sequentialNumber ?? '?')}`;
      }
      if (operationType === 'INVENTORY_ADJUSTMENT') {
        return `Adjustment lotId: ${String(parsed.lotId ?? parsed.adjustmentId ?? '?')}`;
      }
      const formatted = JSON.stringify(parsed);
      return formatted.length > 200 ? `${formatted.slice(0, 200)}…` : formatted;
    } catch {
      return '(unparseable payload)';
    }
  }

  // -------------------------------------------------------------------
  // CSV / JSON export
  // -------------------------------------------------------------------

  async exportEntriesAsCsv(filter: EntryFilter): Promise<string> {
    const entries = await this.fetchFilteredEntries(filter);

    if (entries.length > EXPORT_ROW_LIMIT) {
      throw new DomainError(
        'EXPORT_LIMIT_EXCEEDED',
        `Refine your filter — exports are capped at ${EXPORT_ROW_LIMIT.toLocaleString()} rows. ` +
          `Current filter matches ${entries.length} entries.`,
      );
    }

    const headers = [
      'id', 'operationType', 'operationUuid', 'status', 'retryCount',
      'failureCategory', 'lastErrorMessage', 'nextRetryAt', 'lastAttemptAt',
      'sourceWorkstationId', 'sourceCreatedAt', 'clientSequence', 'payloadHash',
      'payloadSize', 'versionSchema', 'receivedAt', 'processedAt', 'correlationId',
      'workstationId', 'payload',
    ];

    const rows = [headers.join(',')];

    for (const entry of entries) {
      const row = [
        entry.id, entry.operationType, entry.operationUuid, entry.status,
        String(entry.retryCount), entry.failureCategory ?? '',
        this.escapeCsvCell(entry.lastErrorMessage ?? ''),
        entry.nextRetryAt?.toISOString() ?? '',
        entry.lastAttemptAt?.toISOString() ?? '',
        entry.sourceWorkstationId, entry.sourceCreatedAt.toISOString(),
        String(entry.clientSequence), entry.payloadHash,
        String(entry.payloadSize), String(entry.versionSchema),
        entry.receivedAt?.toISOString() ?? '',
        entry.processedAt?.toISOString() ?? '',
        entry.correlationId ?? '', entry.workstationId ?? '',
        this.escapeCsvCell(this.prettyPrintPayload(entry.payload)),
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  async exportEntriesAsJson(filter: EntryFilter): Promise<string> {
    const entries = await this.fetchFilteredEntries(filter);

    if (entries.length > EXPORT_ROW_LIMIT) {
      throw new DomainError(
        'EXPORT_LIMIT_EXCEEDED',
        `Refine your filter — exports are capped at ${EXPORT_ROW_LIMIT.toLocaleString()} rows. ` +
          `Current filter matches ${entries.length} entries.`,
      );
    }

    const enriched = entries.map((entry) => ({
      ...entry,
      clientSequence: String(entry.clientSequence),
      parsedPayload: this.tryParsePayload(entry.payload),
    }));

    return JSON.stringify(enriched, null, 2);
  }

  // -------------------------------------------------------------------
  // Backup metrics
  // -------------------------------------------------------------------

  async getBackupSummary(): Promise<BackupSummary> {
    const { createBackupService } = await import('../backup/backup.service');
    const summary = await createBackupService().getBackupSummary();
    return {
      lastBackupAt: summary.lastBackupAt,
      lastBackupReason: summary.lastBackupReason,
      totalBackups: summary.totalBackups,
      oldestBackupAt: summary.oldestBackupAt,
      totalBackupSizeBytes: summary.totalBackupSizeBytes,
    };
  }

  async getBackupHealth(): Promise<BackupHealthLevel> {
    const { createBackupService } = await import('../backup/backup.service');
    return createBackupService().getBackupHealth();
  }

  async getFiscalSummary(): Promise<FiscalSummary> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twentyFourHoursLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const activeEvent = await this.prisma.contingencyEvent.findFirst({
      where: { endedAt: null },
    });

    const [pendingContingencyInvoices, expiringWithin24h, transmittedLast24h, rejectedLast24h] =
      await Promise.all([
        this.prisma.invoice.count({
          where: { status: 'CONTINGENCY_PENDING_TRANSMISSION' as any },
        }),
        this.prisma.invoice.count({
          where: {
            status: 'CONTINGENCY_PENDING_TRANSMISSION' as any,
            expiresAt: { lte: twentyFourHoursLater, gte: now },
          },
        }),
        this.prisma.invoice.count({
          where: {
            status: 'TRANSMITTED_AUTHORIZED' as any,
            transmittedAt: { gte: twentyFourHoursAgo },
          },
        }),
        this.prisma.invoice.count({
          where: {
            status: 'TRANSMITTED_REJECTED' as any,
            transmittedAt: { gte: twentyFourHoursAgo },
          },
        }),
      ]);

    return {
      contingencyActive: activeEvent !== null,
      pendingContingencyInvoices,
      expiringWithin24h,
      expiredContingencyInvoices: await this.prisma.invoice.count({
        where: { status: 'EXPIRED_CONTINGENCY' as any },
      }),
      transmittedLast24h,
      rejectedLast24h,
    };
  }

  private async fetchFilteredEntries(
    filter: EntryFilter,
  ): Promise<Array<Record<string, unknown>>> {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.operationType) where.operationType = filter.operationType;
    if (filter.failureCategory) where.failureCategory = filter.failureCategory;
    if (filter.since || filter.until) {
      const createdAtFilter: Record<string, Date> = {};
      if (filter.since) createdAtFilter.gte = filter.since;
      if (filter.until) createdAtFilter.lte = filter.until;
      where.sourceCreatedAt = createdAtFilter;
    }

    return this.prisma.syncQueue.findMany({
      where,
      orderBy: { sourceCreatedAt: 'desc' as const },
    }) as unknown as Array<Record<string, unknown>>;
  }

  private prettyPrintPayload(payloadJson: string): string {
    try {
      return JSON.stringify(JSON.parse(payloadJson) as Record<string, unknown>, null, 2);
    } catch {
      return payloadJson;
    }
  }

  private tryParsePayload(payloadJson: string): Record<string, unknown> | null {
    try {
      return JSON.parse(payloadJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Prevent CSV injection: prefix cells starting with `=`, `+`, `-`, `@`,
   * `\t`, or `\r` with a single quote. Quote-wrap cells containing commas,
   * newlines, or double-quotes.
   */
  private escapeCsvCell(value: string): string {
    const firstChar = value.charAt(0);
    if (firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
      value = `'${value}`;
    }
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      value = `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
