/**
 * Local recovery actions for the sync subsystem.
 *
 * Provides two manager-gated (MANAGER or higher) operations:
 * - `retryEntry`: resets a PERMANENT_FAILURE entry back to PENDING so the
 *   next scheduler tick will push it.
 * - `discardEntry`: marks a PERMANENT_FAILURE entry as DISCARDED so it is
 *   excluded from future push cycles.
 *
 * Both operations use optimistic concurrency (transaction with status check)
 * and write an audit row to the local SyncRecoveryLog table.
 *
 * The server is NOT notified of discards — by definition, a discarded entry
 * represents an operation the operator decided not to apply centrally.
 */

import crypto from 'node:crypto';
import type { PrismaClient } from '@pharmacy/database/local';
import { DomainError } from '../../common/domain-error';

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export class EntryNotInPermanentFailureException extends DomainError {
  constructor(entryId: string, currentStatus: string) {
    super(
      'ENTRY_NOT_PERMANENT_FAILURE',
      `Sync entry ${entryId} has status ${currentStatus}, expected PERMANENT_FAILURE`,
    );
  }
}

export class EntryStateChangedException extends DomainError {
  constructor(entryId: string) {
    super(
      'ENTRY_STATE_CHANGED',
      `Sync entry ${entryId} was modified by another operator since the page was loaded`,
    );
  }
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SyncRecoveryService {
  /**
   * Reset a PERMANENT_FAILURE entry back to PENDING.
   *
   * Transactional: reads the entry with a status lock and rejects if the
   * status has already changed (optimistic concurrency). Writes a recovery
   * audit row and returns the updated entry ID.
   *
   * @throws EntryNotInPermanentFailureException
   * @throws EntryStateChangedException
   */
  retryEntry(
    entryId: string,
    actorUserId: string,
  ): Promise<{ id: string; status: string }>;

  /**
   * Permanently discard a PERMANENT_FAILURE entry.
   *
   * Sets the entry to DISCARDED, records the reason in lastErrorMessage,
   * and writes an audit row. Discarded entries are excluded from
   * `pushNextBatch` automatically by the `status = 'PENDING'` guard.
   *
   * @throws EntryNotInPermanentFailureException
   * @throws EntryStateChangedException
   */
  discardEntry(
    entryId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ id: string; status: string }>;
}

export interface SyncRecoveryServiceConfig {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSyncRecoveryService = (
  config: SyncRecoveryServiceConfig,
): SyncRecoveryService => {
  return new SyncRecoveryServiceImpl(config.prisma);
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SyncRecoveryServiceImpl implements SyncRecoveryService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async retryEntry(
    entryId: string,
    actorUserId: string,
  ): Promise<{ id: string; status: string }> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.syncQueue.findUnique({
        where: { id: entryId },
        select: { id: true, status: true },
      });

      if (!entry) {
        throw new EntryNotInPermanentFailureException(entryId, 'NOT_FOUND');
      }

      if (entry.status !== 'PERMANENT_FAILURE') {
        throw new EntryNotInPermanentFailureException(
          entryId,
          entry.status,
        );
      }

      // Optimistic concurrency: try to update only if still PERMANENT_FAILURE
      const updated = await tx.syncQueue.update({
        where: { id: entryId, status: 'PERMANENT_FAILURE' },
        data: {
          status: 'PENDING',
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: null,
          nextRetryAt: new Date(), // Pick up on next scheduler tick
        },
      });

      if (!updated) {
        throw new EntryStateChangedException(entryId);
      }

      // Write audit log
      await tx.syncRecoveryLog.create({
        data: {
          id: crypto.randomUUID(),
          syncQueueEntryId: entryId,
          action: 'RETRY',
          actorUserId,
          at: new Date(),
        },
      });

      return { id: updated.id, status: updated.status };
    });
  }

  async discardEntry(
    entryId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ id: string; status: string }> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.syncQueue.findUnique({
        where: { id: entryId },
        select: { id: true, status: true },
      });

      if (!entry) {
        throw new EntryStateChangedException(entryId);
      }

      if (entry.status !== 'PERMANENT_FAILURE') {
        throw new EntryNotInPermanentFailureException(
          entryId,
          entry.status,
        );
      }

      const updated = await tx.syncQueue.update({
        where: { id: entryId, status: 'PERMANENT_FAILURE' },
        data: {
          status: 'DISCARDED',
          lastErrorMessage: `DISCARDED: ${reason}`,
        },
      });

      if (!updated) {
        throw new EntryStateChangedException(entryId);
      }

      // Write audit log
      await tx.syncRecoveryLog.create({
        data: {
          id: crypto.randomUUID(),
          syncQueueEntryId: entryId,
          action: 'DISCARD',
          reason,
          actorUserId,
          at: new Date(),
        },
      });

      return { id: updated.id, status: updated.status };
    });
  }
}