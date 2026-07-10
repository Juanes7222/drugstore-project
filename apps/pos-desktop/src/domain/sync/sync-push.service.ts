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
 */

import crypto from 'node:crypto';
import type { PrismaClient } from '@pharmacy/database/local';
import type { InvoiceService } from '../fiscal/invoice.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PUSH_BATCH_LIMIT = 10;
export const MAX_RETRY_ATTEMPTS = 10;

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
}

export interface SyncPushServiceConfig {
  prisma: PrismaClient;
  baseUrl: string;
  accessToken?: string;
  invoiceService?: InvoiceService;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSyncPushService = (
  config: SyncPushServiceConfig,
): SyncPushService => {
  const { prisma, baseUrl, accessToken, invoiceService } = config;
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return new SyncPushServiceImpl(prisma, normalizedBase, accessToken, invoiceService);
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type SyncQueueEntryForPush = {
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
 */
interface BatchOperationResult {
  operationUuid: string;
  status: string;
  error?: string;
}

class SyncPushServiceImpl implements SyncPushService {
  private readonly prisma: PrismaClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly invoiceService?: InvoiceService;

  constructor(
    prisma: PrismaClient,
    baseUrl: string,
    accessToken?: string,
    invoiceService?: InvoiceService,
  ) {
    this.prisma = prisma;
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
    this.invoiceService = invoiceService;
  }

  async pushPending(): Promise<{ pushed: number; accepted: number }> {
    const now = new Date();
    const entries = await this.fetchPendingEntries();

    if (entries.length === 0) {
      return { pushed: 0, accepted: 0 };
    }

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

    // --- Perform the HTTP request ---
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/sync/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify(operations),
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Network error during sync push';
      await this.recordBatchFailure(
        entries,
        null,
        'NETWORK',
        errorMessage,
      );
      return { pushed: entries.length, accepted: 0 };
    }

    const bodyText = await response.text().catch(() => '');

    if (response.ok) {
      return await this.handleOkResponse(entries, response.status, bodyText, now);
    }

    // Non-OK response
    if (response.status >= 400 && response.status < 500) {
      const category = classifyFailure(response.status, bodyText);
      await this.recordBatchFailure(
        entries,
        response.status,
        category,
        `Server rejected batch (${response.status}): ${(bodyText || response.statusText).slice(0, 2000)}`,
      );
    } else {
      // Server error (5xx) or unexpected
      await this.recordBatchFailure(
        entries,
        response.status,
        'NETWORK',
        `Server error (${response.status}): ${(bodyText || response.statusText).slice(0, 2000)}`,
      );
    }

    return { pushed: entries.length, accepted: 0 };
  }

  /**
   * Fetch entries that are ready to be pushed:
   * - PENDING entries (never sent)
   * - FAILED entries with retryCount < MAX_RETRY_ATTEMPTS and nextRetryAt <= now
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
      return pending as unknown as SyncEntryForPush[];
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

    return [
      ...(pending as unknown as SyncEntryForPush[]),
      ...(retryable as unknown as SyncEntryForPush[]),
    ];
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
          await tx.syncQueue.update({
            where: { id: entry.id },
            data: { status: 'COMPLETED', lastAttemptAt: now },
          });
          await tx.syncAttempt.create({
            data: {
              id: crypto.randomUUID(),
              syncQueueEntryId: entry.id,
              attemptedAt: now,
              outcome: 'ACCEPTED',
              httpStatus,
            },
          });
          continue;
        }

        if (result.status === 'ALREADY_ACCEPTED') {
          acceptedCount++;
          await tx.syncQueue.update({
            where: { id: entry.id },
            data: { status: 'COMPLETED', lastAttemptAt: now },
          });
          await tx.syncAttempt.create({
            data: {
              id: crypto.randomUUID(),
              syncQueueEntryId: entry.id,
              attemptedAt: now,
              outcome: 'ALREADY_ACCEPTED',
              httpStatus,
            },
          });
          continue;
        }

        // REJECTED — permanent failure from server
        const rejectionCategory = classifyFailure(
          httpStatus,
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
            id: crypto.randomUUID(),
            syncQueueEntryId: entry.id,
            attemptedAt: now,
            outcome: 'REJECTED',
            httpStatus,
            failureCategory: rejectionCategory as any,
            errorMessage: result.error ?? null,
          },
        });

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

    return { pushed: entries.length, accepted: acceptedCount };
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
        const newRetryCount = entry.retryCount + 1;
        const isExhausted = newRetryCount >= MAX_RETRY_ATTEMPTS;
        const outcome = this.mapStatusCodeToOutcome(statusCode);

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
            id: crypto.randomUUID(),
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
   * The server returns an array of `{ operationUuid, status, error? }`.
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
 * Compute the next retry delay in milliseconds using exponential backoff.
 *
 * | Retry count (post-increment) | Wait  |
 * |---|---|
 * | 1 | 30 seconds |
 * | 2 | 2 minutes  |
 * | 3 | 5 minutes  |
 * | 4 | 10 minutes |
 * | 5+ | 30 minutes (capped) |
 */
export function computeNextRetryDelay(retryCount: number): number {
  const delays: Record<number, number> = {
    1: 30_000,
    2: 120_000,
    3: 300_000,
    4: 600_000,
  };
  return delays[retryCount] ?? 1_800_000;
}