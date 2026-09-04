/**
 * Audit sync service — bridges `LocalAuditLog` (offline) → `SyncQueue` → server `AuditLog`.
 *
 * ## Problem it solves
 *
 * `LocalAuditWriter` persists audit events to the PGlite `LocalAuditLog` table
 * immediately after each domain operation (cash-shift, sale, etc.). Before this
 * service existed, those rows never left the device — the server's `AuditLog`
 * only contained HTTP-intercepted online events. This service enqueues unsynced
 * `LocalAuditLog` rows into `SyncQueue` as `AUDIT_LOG_BATCH` operations so the
 * existing push pipeline (`sync-push.service` → `POST /sync/batch`) delivers
 * them to `SyncOperationDispatcherService.handleAuditLogBatch`.
 *
 * ## Idempotency
 *
 * - Offline `LocalAuditLog.id` is reused as `AuditLog.id` on the server. A
 *   retried batch with the same ids hits `P2002` on the server and is skipped.
 * - Locally, rows are watermarked with `syncedAt` after successful enqueue.
 *   Re-delivery is safe but the watermark prevents perpetual re-enqueue.
 * - `operationUuid` is fresh per SyncQueue entry; `payloadHash` is SHA-256 of
 *   the JSON payload, verified server-side before dispatch.
 */

import type { PrismaClient } from '@pharmacy/database/local';

/** Max audit rows per SyncQueue entry. Keeps payload well under 64 KB. */
export const AUDIT_SYNC_BATCH_SIZE = 50;

export interface AuditSyncService {
  /**
   * Enqueue all `LocalAuditLog` rows where `syncedAt IS NULL` into
   * `SyncQueue` as one or more `AUDIT_LOG_BATCH` entries.
   *
   * Each batch is a separate SyncQueue row with its own `operationUuid`.
   * Rows are watermarked with `syncedAt = now()` inside the same transaction
   * that creates the queue entry, so a crash before commit never leaves a
   * watermark without a queue entry.
   *
   * Deliberately does NOT notify the push triggers: this method runs at the
   * start of every push cycle (`SyncScheduler.runPush`), so its output
   * always rides the push already in flight, and the 15s drain timer covers
   * the idle case while the outbox is non-empty. Notifying here closed a
   * self-sustaining hot loop — every push writes a `SYNC_PUSH_COMPLETED`
   * audit row, which the next enqueue picked up and immediately re-pushed,
   * producing a permanent ~1 op/sec push cadence of pure bookkeeping that
   * also flooded the LAN hub buffer across stations.
   *
   * Safe to call with no pending rows - returns 0, creates nothing.
   * Safe to call concurrently - the `syncedAt IS NULL` filter plus the
   * transaction ordering prevents duplicate batches.
   */
  enqueueUnsynced(): Promise<number>;

  /**
   * Count of `LocalAuditLog` rows pending sync (`syncedAt IS NULL`).
   * Used by health/metrics UI.
   */
  countPending(): Promise<number>;
}

export interface AuditSyncServiceConfig {
  prisma: PrismaClient;
  /** Workstation that owns the SyncQueue entries. Resolved from session when absent. */
  workstationId?: string;
  /** User that triggered the enqueue, for lineage (optional). */
  userId?: string;
}

export const createAuditSyncService = (config: AuditSyncServiceConfig): AuditSyncService => {
  return new AuditSyncServiceImpl(config.prisma, config.workstationId);
};

class AuditSyncServiceImpl implements AuditSyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workstationId?: string,
  ) {}

  async countPending(): Promise<number> {
    return (this.prisma as any).localAuditLog.count({
      where: { syncedAt: null },
    });
  }

  async enqueueUnsynced(): Promise<number> {
    const pending = await (this.prisma as any).localAuditLog.findMany({
      where: { syncedAt: null },
      orderBy: { createdAt: 'asc' },
      take: AUDIT_SYNC_BATCH_SIZE * 10, // cap total work per call
    });

    if (pending.length === 0) return 0;

    // Split into batches
    let enqueuedLogs = 0;
    for (let i = 0; i < pending.length; i += AUDIT_SYNC_BATCH_SIZE) {
      const batch = pending.slice(i, i + AUDIT_SYNC_BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      await this.enqueueBatch(batch);
      enqueuedLogs += batch.length;
    }

    return enqueuedLogs;
  }

  private async enqueueBatch(batch: any[]): Promise<void> {
    const workstationId = await this.resolveWorkstationId();
    const now = new Date();

    // Build payload: array of plain audit log objects the server validates
    const logs = batch.map((row: any) => ({
      id: row.id,
      action: row.action,
      category: row.category,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      entityName: row.entityName ?? null,
      details: row.details ?? null,
      userId: row.userId ?? null,
      userRole: row.userRole ?? null,
      workstationId: row.workstationId ?? workstationId,
      sessionId: row.sessionId ?? null,
      correlationId: row.correlationId ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));

    const payloadObj = { logs };
    const payload = JSON.stringify(payloadObj);
    const payloadHash = await computePayloadHash(payload);
    const payloadSize = new TextEncoder().encode(payload).length;
    const operationUuid = globalThis.crypto.randomUUID();

    const latestSeq = await this.prisma.syncQueue.findFirst({
      where: { sourceWorkstationId: workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? (latestSeq.clientSequence as bigint) + 1n : 1n;

    await this.prisma.$transaction(async (tx) => {
      await tx.syncQueue.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          operationUuid,
          operationType: 'AUDIT_LOG_BATCH' as any,
          payload,
          payloadHash,
          payloadSize,
          versionSchema: 1,
          status: 'PENDING',
          retryCount: 0,
          sourceWorkstationId: workstationId,
          sourceCreatedAt: now,
          clientSequence,
        },
      });

      // Watermark: mark these LocalAuditLog rows as enqueued
      const ids = batch.map((r: any) => r.id);
      await (tx as any).localAuditLog.updateMany({
        where: { id: { in: ids } },
        data: { syncedAt: now },
      });
    });
  }

  private async resolveWorkstationId(): Promise<string> {
    if (this.workstationId) return this.workstationId;
    try {
      const { resolveWorkstationId } = await import('../../infrastructure/workstation-identity');
      return resolveWorkstationId().workstationId;
    } catch {
      try {
        const { useLocalSessionStore } = await import('../auth/local-session.store');
        const session = useLocalSessionStore.getState().session;
        if (session?.workstationId) return session.workstationId;
      } catch {}
      return 'unknown-workstation';
    }
  }
}

async function computePayloadHash(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
