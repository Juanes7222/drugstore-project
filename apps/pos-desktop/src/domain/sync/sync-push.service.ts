/**
 * Push service for the POS desktop sync engine.
 *
 * Reads pending (PENDING) and retryable (FAILED) SyncQueue entries from the
 * local database, serialises them into a batch, and POSTs them to the server's
 * `/sync/batch` endpoint. After each push attempt, it records a SyncAttempt
 * row in the local database and updates the parent entry's state.
 *
 * Failure classification
 * ------------------------
 * Before writing a SyncQueue update, the service classifies the failure
 * category based on the HTTP status code and response body. The mapping
 * lives in `classifyFailure()` — the single source of truth for all callers.
 *
 * Retry semantics
 * ---------------
 * The 10-attempt exponential-backoff logic from Phase 1 is preserved
 * unchanged. When the 10th attempt fails, the entry transitions to
 * PERMANENT_FAILURE with the classified failureCategory (previously it
 * remained as FAILED with no structured category). Entries with DISCARDED
 * or PERMANENT_FAILURE status are never selected.
 *
 * One deliberate exception: an AUTH failure recorded while the push
 * service holds no offline token means the request went out with an
 * expired/absent access token and no fallback credential — the entry
 * cannot succeed until credentials recover, so the attempt is recorded
 * but the retry budget (retryCount / nextRetryAt) is left untouched.
 * See `recordBatchFailure`.
 */

import { Prisma, type PrismaClient } from '@pharmacy/database/local';
import type { InvoiceService } from '../fiscal/invoice.service';
import type { LocalAuditWriter } from '../audit/local-audit-writer.service';
import { LocalAuditEvent } from '../audit/local-audit-writer.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PUSH_BATCH_LIMIT = 10;
export const MAX_RETRY_ATTEMPTS = 10;

/**
 * Priority groups for operation types.
 *
 * Groups ensure operations are pushed in dependency-safe order without
 * needing to parse every payload to trace references. Operations that
 * other operations depend on are in the highest priority groups.
 *
 * The sort within a group uses clientSequence so the original order
 * within the same dependency level is preserved.
 *
 * | Priority | Group | Operation types |
 * |---|---|---|
 * | 1 (highest) | Entity creation | PRODUCT_CREATION, CLIENT_CREATION |
 * | 2 | Entity update  | PRODUCT_UPDATE, CLIENT_UPDATE |
 * | 3 | Sales          | SALE_CONFIRMATION, SHIFT_CLOSURE |
 * | 4 | Post-sale ops  | INVENTORY_ADJUSTMENT, CLIENT_RETURN, CLIENT_CREDIT_PAYMENT, CLIENT_CREDIT_PAYMENT_ANNULMENT, PRESCRIPTION_REGISTRATION |
 * | 5 | Fiscal         | INVOICE_TRANSMISSION, INVOICE_ADJUSTMENT, FISCAL_DOCUMENT_SYNC |
 * | 6 | Purchases      | PURCHASE_ORDER_CONFIRMATION, PURCHASE_RECEPTION_CONFIRMATION, SUPPLIER_RETURN_CONFIRMATION |
 * | 7 (lowest) | Misc  | CLIENT_DEACTIVATE, RESOLUTION_ALLOCATION, INVOICE_TRANSMISSION_RESULT |
 *
 * Exported so the LAN relay engine reuses the exact same dependency-safe
 * ordering when picking entries to broadcast to the local-network hub.
 */
export const OPERATION_PRIORITY: Record<string, number> = {
  PRODUCT_CREATION: 1,
  CLIENT_CREATION: 1,
  PRODUCT_UPDATE: 2,
  CLIENT_UPDATE: 2,
  SALE_CONFIRMATION: 3,
  SHIFT_CLOSURE: 3,
  INVENTORY_ADJUSTMENT: 4,
  CLIENT_RETURN: 4,
  CLIENT_CREDIT_PAYMENT: 4,
  CLIENT_CREDIT_PAYMENT_ANNULMENT: 4,
  PRESCRIPTION_REGISTRATION: 4,
  INVOICE_TRANSMISSION: 5,
  INVOICE_ADJUSTMENT: 5,
  FISCAL_DOCUMENT_SYNC: 5,
  PURCHASE_ORDER_CONFIRMATION: 6,
  PURCHASE_RECEPTION_CONFIRMATION: 6,
  SUPPLIER_RETURN_CONFIRMATION: 6,
  CLIENT_DEACTIVATE: 7,
  RESOLUTION_ALLOCATION: 7,
  INVOICE_TRANSMISSION_RESULT: 7,
};

const DEFAULT_PRIORITY = 99;

/**
 * Synthetic client-error status used to classify per-operation REJECTED
 * results. Those arrive inside an HTTP-200 batch response, so the batch
 * status carries no signal — routing the error body through a generic
 * 4xx branch lets conflict/business-rule keywords drive the category.
 */
const REJECTED_OPERATION_STATUS = 412;

/** The local-only failure category values. */
export type SyncFailureCategory =
  | 'NETWORK'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'AUTH'
  | 'BUSINESS_RULE'
  | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Failure classification (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Classify a push failure into a structured SyncFailureCategory.
 *
 * This is the single classification helper for the entire push flow.
 * Every caller routes through this function so that the classification
 * mapping is never scattered across callers.
 *
 * @param statusCode  HTTP status code (null for network errors)
 * @param responseBody  Response body text, if available
 */
export function classifyFailure(
  statusCode: number | null,
  responseBody: string,
): SyncFailureCategory {
  if (statusCode === null) {
    return 'NETWORK';
  }

  if (statusCode === 401 || statusCode === 403) {
    return 'AUTH';
  }

  if (statusCode === 409) {
    return 'CONFLICT';
  }

  const lower = responseBody.toLowerCase();

  if (statusCode === 422 || statusCode === 400) {
    if (
      lower.includes('validation') ||
      lower.includes('schema') ||
      lower.includes('zod') ||
      lower.includes('malformed') ||
      lower.includes('invalid')
    ) {
      return 'VALIDATION';
    }
    if (lower.includes('conflict') || lower.includes('mismatch')) {
      return 'CONFLICT';
    }
    if (
      lower.includes('prescription') ||
      lower.includes('shift') ||
      lower.includes('closed') ||
      lower.includes('not allowed')
    ) {
      return 'BUSINESS_RULE';
    }
    return 'VALIDATION';
  }

  if (statusCode >= 400 && statusCode < 500) {
    if (
      lower.includes('prescription') ||
      lower.includes('not allowed') ||
      lower.includes('stock') ||
      lower.includes('insufficient') ||
      lower.includes('business')
    ) {
      return 'BUSINESS_RULE';
    }
    if (
      lower.includes('conflict') ||
      lower.includes('mismatch') ||
      lower.includes('already')
    ) {
      return 'CONFLICT';
    }
    return 'BUSINESS_RULE';
  }

  // 5xx or unexpected status
  return 'NETWORK';
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SyncPushService {
  /** Push one batch of pending operations to the server. */
  pushPending(): Promise<{ pushed: number; accepted: number }>;
  /** Phase 1 — read the batch (DB reads only, no network). */
  preparePush(): Promise<PushPreparedBatch>;
  /** Phase 2 — POST the batch to the server (network only, no DB). */
  sendBatch(prepared: PushPreparedBatch): Promise<PushTransportResult>;
  /** Phase 3 — apply the transport outcome to the DB (must hold the lock). */
  applyPushResult(
    prepared: PushPreparedBatch,
    transport: PushTransportResult,
    now: Date,
  ): Promise<{ pushed: number; accepted: number }>;
}

/**
 * Everything `preparePush` gathers, handed to `sendBatch` and
 * `applyPushResult`. The three-phase split lets the sync scheduler run the
 * network POST without the PGlite write lock and lock only the DB writes.
 */
export interface PushPreparedBatch {
  entries: SyncEntryForPush[];
  operations: unknown[];
  headers: Record<string, string>;
}

/** Outcome of the network POST, applied to the DB under the lock. */
export interface PushTransportResult {
  ok: boolean;
  status: number | null;
  statusText: string;
  bodyText: string;
  /** Set when `fetch` itself threw — treated as a NETWORK failure. */
  networkErrorMessage?: string;
}

export interface SyncPushServiceConfig {
  prisma: PrismaClient;
  baseUrl: string;
  accessToken?: string;
  /** Long-lived JWT sent as X-Offline-Token alongside the Bearer access token. */
  offlineToken?: string;
  invoiceService?: InvoiceService;
  auditWriter?: LocalAuditWriter;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSyncPushService = (
  config: SyncPushServiceConfig,
): SyncPushService => {
  const { prisma, baseUrl, accessToken, offlineToken, invoiceService, auditWriter } = config;
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return new SyncPushServiceImpl(prisma, normalizedBase, accessToken, offlineToken, invoiceService, auditWriter);
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type SyncEntryForPush = {
  id: string;
  operationUuid: string;
  operationType: string;
  payload: string;
  payloadHash: string;
  sourceCreatedAt: Date;
  clientSequence: bigint;
  retryCount: number;
  status: string;
};

/**
 * Per-operation result from the server's batch response.
 *
 * The server includes the new entity's server-assigned id in
 * `entityId` for create-style operations (`PRODUCT_CREATION`,
 * `CLIENT_CREATION`, etc.). The push pipeline reads this so it can
 * stamp the corresponding local row's `serverId` after the
 * SyncQueue entry transitions to COMPLETED — that's how the
 * sales-pos service knows a product is "synced" and safe to sell.
 */
interface BatchOperationResult {
  operationUuid: string;
  status: string;
  error?: string;
  /**
   * Server-assigned id of the created/mutated entity. The local row's
   * `serverId` column is stamped with this value after a successful
   * push — see `stampEntityIdFromResult` and the sales-pos
   * `assertProductsSynced` gate that reads it.
   */
  entityId?: string;
  /**
   * Server-chosen `internalCode` for the created entity. Only set for
   * `*_CREATION` operations whose provisional local value (e.g.
   * `OFFLINE-{uuid}`) the server is expected to replace with a
   * tenant-scoped sequential or otherwise clean code. The local
   * stamp pipeline applies this value only when the local row still
   * carries the provisional code, so a later cashier-driven
   * `internalCode` edit on the local row is never overwritten.
   */
  entityInternalCode?: string;
}

class SyncPushServiceImpl implements SyncPushService {
  private readonly prisma: PrismaClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;
  private readonly invoiceService?: InvoiceService;
  private readonly auditWriter?: LocalAuditWriter;

  constructor(
    prisma: PrismaClient,
    baseUrl: string,
    accessToken?: string,
    offlineToken?: string,
    invoiceService?: InvoiceService,
    auditWriter?: LocalAuditWriter,
  ) {
    this.prisma = prisma;
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
    this.offlineToken = offlineToken;
    this.invoiceService = invoiceService;
    this.auditWriter = auditWriter;
  }

  async pushPending(): Promise<{ pushed: number; accepted: number }> {
    // Convenience for callers that do not orchestrate the PGlite write lock
    // themselves: prepare (read) → send (network) → apply (write), all
    // without holding the lock. The sync scheduler calls the three phases
    // around the lock so a slow server round-trip never blocks foreground
    // operations.
    const prepared = await this.preparePush();
    if (prepared.entries.length === 0) {
      return { pushed: 0, accepted: 0 };
    }
    const transport = await this.sendBatch(prepared);
    return this.applyPushResult(prepared, transport, new Date());
  }

  /**
   * Phase 1 — read: load the batch of PENDING/retryable entries, serialise
   * them, and build the request headers. Database reads only; no network.
   */
  async preparePush(): Promise<PushPreparedBatch> {
    const entries = await this.fetchPendingEntries();

    const operations = entries.map((entry) => ({
      operationType: entry.operationType,
      operationUuid: entry.operationUuid,
      payload: JSON.parse(entry.payload) as Record<string, unknown>,
      payloadHash: entry.payloadHash,
      sourceCreatedAt: entry.sourceCreatedAt.toISOString(),
      clientSequence: Number(entry.clientSequence),
    }));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    if (this.offlineToken) {
      headers['X-Offline-Token'] = this.offlineToken;
    }

    return { entries, operations, headers };
  }

  /**
   * Phase 2 — network: POST the batch to `/sync/batch`. No database access;
   * the transport result is applied later under the lock.
   */
  async sendBatch(prepared: PushPreparedBatch): Promise<PushTransportResult> {
    try {
      const response = await fetch(`${this.baseUrl}/sync/batch`, {
        method: 'POST',
        headers: prepared.headers,
        body: JSON.stringify(prepared.operations),
      });
      const bodyText = await response.text().catch(() => '');
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyText,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        statusText: '',
        bodyText: '',
        networkErrorMessage:
          err instanceof Error ? err.message : 'Network error during sync push',
      };
    }
  }

  /**
   * Phase 3 — write: apply the transport outcome to the local database
   * (queue updates, attempt log, entity stamps, audit). Must run under the
   * PGlite write lock.
   */
  async applyPushResult(
    prepared: PushPreparedBatch,
    transport: PushTransportResult,
    now: Date,
  ): Promise<{ pushed: number; accepted: number }> {
    const entries = prepared.entries;

    if (entries.length === 0) {
      return { pushed: 0, accepted: 0 };
    }

    // The fetch itself threw — network failure.
    if (transport.networkErrorMessage !== undefined) {
      const errorMessage = transport.networkErrorMessage;
      await this.recordBatchFailure(entries, null, 'NETWORK', errorMessage);
      this.auditWriter?.write(LocalAuditEvent.SYNC_PUSH_FAILED, {
        category: 'sync',
        entityType: 'SyncQueue',
        details: {
          pushedCount: entries.length,
          acceptedCount: 0,
          failureCategory: 'NETWORK',
          errorMessage,
          operationTypes: [...new Set(entries.map((e) => e.operationType))],
        },
      });
      return { pushed: entries.length, accepted: 0 };
    }

    const { status, statusText, bodyText } = transport;

    if (transport.ok) {
      return await this.handleOkResponse(
        entries,
        status ?? 200,
        bodyText,
        now,
      );
    }

    // Non-OK response
    let failureCategory: SyncFailureCategory;
    if (status !== null && status >= 400 && status < 500) {
      failureCategory = classifyFailure(status, bodyText);
      await this.recordBatchFailure(
        entries,
        status,
        failureCategory,
        `Server rejected batch (${status}): ${(bodyText || statusText).slice(0, 2000)}`,
      );
    } else {
      // Server error (5xx) or unexpected
      failureCategory = 'NETWORK';
      await this.recordBatchFailure(
        entries,
        status,
        failureCategory,
        `Server error (${status}): ${(bodyText || statusText).slice(0, 2000)}`,
      );
    }

    this.auditWriter?.write(LocalAuditEvent.SYNC_PUSH_FAILED, {
      category: 'sync',
      entityType: 'SyncQueue',
      details: {
        pushedCount: entries.length,
        acceptedCount: 0,
        failureCategory,
        statusCode: status ?? undefined,
        operationTypes: [...new Set(entries.map((e) => e.operationType))],
      },
    });

    return { pushed: entries.length, accepted: 0 };
  }

  /**
   * Fetch entries that are ready to be pushed:
   * - PENDING entries (never sent)
   * - FAILED entries with retryCount < MAX_RETRY_ATTEMPTS and nextRetryAt <= now
   *
   * Sorted by dependency-safe priority (creations first, then edits, then
   * sales, then post-sale operations), then by clientSequence within each
   * priority group. This ensures PRODUCT_CREATION and CLIENT_CREATION are
   * pushed before SALE_CONFIRMATION entries that reference them, without
   * needing to parse every payload to trace entity references.
   *
   * Defense-in-depth: the pending query uses `status = 'PENDING'` explicitly,
   * never `status != 'COMPLETED'`, so discarded/permanent-failure entries
   * are automatically excluded (they have different status values).
   */
  private async fetchPendingEntries(): Promise<SyncEntryForPush[]> {
    const now = new Date();
    const pending = await this.prisma.syncQueue.findMany({
      where: { status: 'PENDING' },
      orderBy: { clientSequence: 'asc' as const },
      take: PUSH_BATCH_LIMIT,
    });

    const remaining = PUSH_BATCH_LIMIT - pending.length;
    if (remaining <= 0) {
      return this.sortByPriority(pending as unknown as SyncEntryForPush[]);
    }

    const retryable = await this.prisma.syncQueue.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: MAX_RETRY_ATTEMPTS },
        nextRetryAt: { lte: now },
      },
      orderBy: { clientSequence: 'asc' as const },
      take: remaining,
    });

    const combined = [
      ...(pending as unknown as SyncEntryForPush[]),
      ...(retryable as unknown as SyncEntryForPush[]),
    ];
    return this.sortByPriority(combined);
  }

  /**
   * Sort entries by dependency-safe priority, then by clientSequence
   * within each priority group.
   *
   * Stable for entries with same priority+sequence: their original order
   * from the DB (which respects insertion order within the same
   * clientSequence) is preserved.
   */
  private sortByPriority(entries: SyncEntryForPush[]): SyncEntryForPush[] {
    return entries.sort((a, b) => {
      const pA = OPERATION_PRIORITY[a.operationType] ?? DEFAULT_PRIORITY;
      const pB = OPERATION_PRIORITY[b.operationType] ?? DEFAULT_PRIORITY;
      if (pA !== pB) return pA - pB;
      return Number(a.clientSequence) - Number(b.clientSequence);
    });
  }

  /**
   * Handle a successful HTTP response (2xx).
   * The server returns per-operation results.
   */
  private async handleOkResponse(
    entries: SyncEntryForPush[],
    httpStatus: number,
    bodyText: string,
    now: Date,
  ): Promise<{ pushed: number; accepted: number }> {
    const results = this.parseBatchResults(bodyText);
    const resultMap = new Map<string, BatchOperationResult>();
    for (const r of results) {
      resultMap.set(r.operationUuid, r);
    }

    let acceptedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        const result = resultMap.get(entry.operationUuid);

        if (!result || result.status === 'ACCEPTED') {
          acceptedCount++;
          await this.markEntryCompleted(tx, entry, 'ACCEPTED', httpStatus, now);
          await this.stampEntityIdFromResult(tx, entry, result);
          continue;
        }

        if (result.status === 'ALREADY_ACCEPTED') {
          acceptedCount++;
          await this.markEntryCompleted(
            tx,
            entry,
            'ALREADY_ACCEPTED',
            httpStatus,
            now,
          );
          await this.stampEntityIdFromResult(tx, entry, result);
          continue;
        }

        // REJECTED — permanent failure from server. The batch HTTP status
        // (typically 200) says nothing about an individual operation, so
        // classify from the error body alone via a generic client-error status.
        const rejectionCategory = classifyFailure(
          REJECTED_OPERATION_STATUS,
          result.error ?? '',
        );
        await tx.syncQueue.update({
          where: { id: entry.id },
          data: {
            status: 'PERMANENT_FAILURE',
            lastErrorMessage: result.error ?? 'Server rejected operation',
            failureCategory: rejectionCategory as any,
            lastAttemptAt: now,
          },
        });
        await tx.syncAttempt.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            syncQueueEntryId: entry.id,
            attemptedAt: now,
            outcome: 'REJECTED',
            httpStatus,
            failureCategory: rejectionCategory as any,
            errorMessage: result.error ?? null,
          },
        });

        // Audit trail — individual sync conflict or rejection
        if (rejectionCategory === 'CONFLICT') {
          this.auditWriter?.write(LocalAuditEvent.SYNC_CONFLICT, {
            category: 'sync',
            entityType: 'SyncQueue',
            entityId: entry.id,
            details: {
              operationType: entry.operationType,
              operationUuid: entry.operationUuid,
              error: result.error ?? 'Conflict detected by server',
              rejectionCategory,
            },
          });
        }

        // If a SALE_CONFIRMATION was rejected, cancel any associated local
        // invoices to prevent orphan fiscal documents.
        if (entry.operationType === 'SALE_CONFIRMATION' && this.invoiceService) {
          try {
            const parsedPayload = JSON.parse(entry.payload) as { metadata?: { localSaleId?: string } };
            const localSaleId = parsedPayload?.metadata?.localSaleId;
            if (localSaleId) {
              const invoices = await this.invoiceService.findBySaleId(localSaleId);
              for (const inv of invoices) {
                await this.invoiceService.cancelInvoice(
                  inv.id,
                  `Sale replay rejected: ${result.error ?? 'Server rejection'}`,
                );
              }
            }
          } catch (cancelErr) {
            console.error(
              `[SyncPush] Failed to cancel invoices for rejected sale:`,
              cancelErr,
            );
          }
        }
      }
    });

    // Audit trail — sync push completed
    const rejectedCount = entries.length - acceptedCount;
    this.auditWriter?.write(LocalAuditEvent.SYNC_PUSH_COMPLETED, {
      category: 'sync',
      entityType: 'SyncQueue',
      details: {
        pushedCount: entries.length,
        acceptedCount,
        rejectedCount,
        httpStatus,
        operationTypes: [...new Set(entries.map((e) => e.operationType))],
      },
    });

    return { pushed: entries.length, accepted: acceptedCount };
  }

  /**
   * Transition a SyncQueue entry to COMPLETED and record a
   * `SyncAttempt` row. The two writes happen inside the caller's
   * transaction so the queue and the attempt log stay consistent.
   *
   * Extracted from the inline branches in `handleOkResponse` so both
   * the `ACCEPTED` and `ALREADY_ACCEPTED` paths can share it — and so
   * the post-complete entity-id stamping in
   * `stampEntityIdFromResult` has a single chokepoint to attach to.
   */
  private async markEntryCompleted(
    tx: Prisma.TransactionClient,
    entry: SyncEntryForPush,
    outcome: 'ACCEPTED' | 'ALREADY_ACCEPTED',
    httpStatus: number,
    now: Date,
  ): Promise<void> {
    await tx.syncQueue.update({
      where: { id: entry.id },
      data: { status: 'COMPLETED', lastAttemptAt: now },
    });
    await tx.syncAttempt.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        syncQueueEntryId: entry.id,
        attemptedAt: now,
        outcome,
        httpStatus,
      },
    });
  }

  /**
   * After a SyncQueue entry reaches COMPLETED, stamp the
   * server-assigned id (and `internalCode` when the server supplied
   * one) onto the local row so the rest of the app can treat the
   * entity as "synced" and display the canonical code instead of the
   * provisional `OFFLINE-{uuid}` the cashier's offline create used.
   *
   * Currently only handles PRODUCT_CREATION. The payload's
   * `metadata.productId` carries the local UUID; the batch result's
   * `entityId` carries the server-assigned id and `entityInternalCode`
   * the server-chosen clean code. Both writes happen inside the same
   * transaction as the SyncQueue update so a crash between "server
   * accepted" and "local stamp" cannot leave a perpetual orphan. If a
   * future operation type needs the same treatment (CLIENT_CREATION,
   * SUPPLIER_RETURN, etc.) extend the switch below — the rest of the
   * pipeline already carries `entityId` and `entityInternalCode`
   * through.
   *
   * The `internalCode` stamp is guarded by a `current internalCode
   * starts with 'OFFLINE-'` check, so a later cashier-driven
   * `internalCode` edit on the local row is never overwritten by a
   * stale server echo. The OFFLINE- prefix is the marker that
   * `createProduct` (see `product.service.ts:606`) uses to flag a
   * row that has never been touched by a successful sync.
   *
   * Failures inside the stamp are swallowed: the entry is COMPLETED
   * and will not be re-pushed, so a stamp failure must not roll the
   * whole batch back. The next `enqueueUnsyncedProducts()` pass on
   * the next reconnect will see the still-null `serverId` and re-enqueue
   * a PRODUCT_CREATION with a fresh `operationUuid`; the server's
   * `internalCode`-based idempotency will fold it together.
   */
  private async stampEntityIdFromResult(
    tx: Prisma.TransactionClient,
    entry: SyncEntryForPush,
    result: BatchOperationResult | undefined,
  ): Promise<void> {
    if (!result?.entityId) return;
    if (entry.operationType !== 'PRODUCT_CREATION') return;

    const localProductId = extractProductIdFromProductCreationPayload(
      entry.payload,
    );
    if (localProductId === null) return;

    const updateData: Record<string, string> = {
      serverId: result.entityId,
    };
    if (
      result.entityInternalCode !== undefined &&
      result.entityInternalCode.length > 0
    ) {
      // Read the current row so we can decide whether the server
      // echo is replacing a provisional code or stomping a real one.
      // The extra SELECT is cheap and avoids a blind `updateMany` that
      // could clobber a manual edit the cashier made after sync.
      const current = await tx.product.findUnique({
        where: { id: localProductId },
        select: { internalCode: true },
      });
      if (
        current !== null &&
        current.internalCode.startsWith('OFFLINE-') &&
        current.internalCode !== result.entityInternalCode
      ) {
        updateData.internalCode = result.entityInternalCode;
      }
    }

    try {
      await tx.product.update({
        where: { id: localProductId },
        data: updateData,
      });
    } catch (err) {
      // The local row may have been soft-deleted or its schema may
      // have evolved since the payload was enqueued. Logging and
      // moving on is the correct trade-off — the SyncQueue entry is
      // already COMPLETED, the server is no longer tracking it, and
      // a permanent error here would deadlock the rest of the batch.
      console.warn(
        `[SyncPush] Failed to stamp serverId on product ${localProductId} ` +
          `from operation ${entry.operationUuid}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Record a failure for all entries in a batch.
   * Each entry is updated individually because retryCount differs per row.
   */
  private async recordBatchFailure(
    entries: SyncEntryForPush[],
    statusCode: number | null,
    failureCategory: SyncFailureCategory,
    errorMessage: string,
  ): Promise<void> {
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        const outcome = this.mapStatusCodeToOutcome(statusCode);

        // Known-bad auth: the push went out with an expired or absent
        // access token and the push service holds no offline token to
        // fall back on (the scheduler's auth-readiness gate suppresses
        // these once detected, but a push can still slip through — e.g.
        // a token the client believes is fresh that the server rejects).
        // The entry cannot succeed until credentials recover, so do not
        // consume the retry budget: record the attempt, leave retryCount
        // and nextRetryAt untouched. PENDING-origin entries keep
        // nextRetryAt null and are picked up by the first push after
        // re-auth; FAILED entries with stale backoff are reset by the
        // scheduler on successful refresh/exchange. An AUTH failure WITH
        // an offline token (revoked/expired offline credential) still
        // uses the normal backoff path below.
        if (failureCategory === 'AUTH' && !this.offlineToken) {
          await tx.syncQueue.update({
            where: { id: entry.id },
            data: {
              lastAttemptAt: now,
              failureCategory,
              lastErrorMessage: errorMessage,
            },
          });
          await tx.syncAttempt.create({
            data: {
              id: globalThis.crypto.randomUUID(),
              syncQueueEntryId: entry.id,
              attemptedAt: now,
              outcome,
              httpStatus: statusCode,
              failureCategory,
              errorMessage,
            },
          });
          continue;
        }

        const newRetryCount = entry.retryCount + 1;
        const isExhausted = newRetryCount >= MAX_RETRY_ATTEMPTS;

        const updateData: Record<string, unknown> = {
          retryCount: newRetryCount,
          lastAttemptAt: now,
          failureCategory,
          lastErrorMessage: isExhausted
            ? `Exceeded maximum retry attempts: ${errorMessage}`
            : errorMessage,
        };

        if (isExhausted) {
          updateData.status = 'PERMANENT_FAILURE';
        } else {
          updateData.nextRetryAt = new Date(
            Date.now() + computeNextRetryDelay(newRetryCount),
          );
        }

        await tx.syncQueue.update({
          where: { id: entry.id },
          data: updateData,
        });

        await tx.syncAttempt.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            syncQueueEntryId: entry.id,
            attemptedAt: now,
            outcome,
            httpStatus: statusCode,
            failureCategory,
            errorMessage,
          },
        });
      }
    });
  }

  private mapStatusCodeToOutcome(
    statusCode: number | null,
  ): 'ACCEPTED' | 'ALREADY_ACCEPTED' | 'REJECTED' | 'NETWORK_ERROR' {
    if (statusCode === null) return 'NETWORK_ERROR';
    if (statusCode >= 400 && statusCode < 500) return 'REJECTED';
    return 'NETWORK_ERROR';
  }

  /**
   * Parse the per-operation results from a batch response.
   * The server returns an array of
   * `{ operationUuid, status, error?, entityId?, entityInternalCode? }`.
   * `entityInternalCode` is present only when the server is willing to
   * overwrite the local provisional code (e.g. `OFFLINE-{uuid}`) with
   * a tenant-scoped value — absent for every other operation type.
   */
  private parseBatchResults(bodyText: string): BatchOperationResult[] {
    try {
      const parsed = JSON.parse(bodyText);
      if (Array.isArray(parsed)) {
        return parsed.map(
          (item: Record<string, unknown>): BatchOperationResult => ({
            operationUuid: String(item.operationUuid ?? ''),
            status: String(item.status ?? ''),
            error: item.error != null ? String(item.error) : undefined,
            entityId:
              item.entityId != null ? String(item.entityId) : undefined,
            entityInternalCode:
              item.entityInternalCode != null
                ? String(item.entityInternalCode)
                : undefined,
          }),
        );
      }
      return [];
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the next retry delay in milliseconds using exponential backoff
 * with ±20% jitter.
 *
 * Jitter prevents synchronized retry storms when multiple workstations
 * lose connectivity simultaneously and all come back online at once.
 *
 * | Retry count (post-increment) | Base wait | Range (with jitter) |
 * |---|---|---|
 * | 1 | 30 seconds | 24 s – 36 s |
 * | 2 | 2 minutes  | 96 s – 144 s |
 * | 3 | 5 minutes  | 4 min – 6 min |
 * | 4 | 10 minutes | 8 min – 12 min |
 * | 5+ | 30 minutes (capped) | 24 min – 36 min |
 */
export function computeNextRetryDelay(retryCount: number): number {
  const delays: Record<number, number> = {
    1: 30_000,
    2: 120_000,
    3: 300_000,
    4: 600_000,
  };
  const base = delays[retryCount] ?? 1_800_000;
  const jitter = base * (0.8 + Math.random() * 0.4); // ±20%
  return Math.round(jitter);
}

// ---------------------------------------------------------------------------
// Module-level helpers — payload parsing
// ---------------------------------------------------------------------------

/**
 * Safely extract `metadata.productId` from a PRODUCT_CREATION payload.
 * Returns `null` when the payload can't be parsed or doesn't carry the
 * expected field — callers treat null as "skip, do not stamp".
 */
function extractProductIdFromProductCreationPayload(
  payload: string,
): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      metadata?: { productId?: unknown };
    };
    const value = parsed.metadata?.productId;
    if (typeof value !== 'string' || value.length === 0) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}