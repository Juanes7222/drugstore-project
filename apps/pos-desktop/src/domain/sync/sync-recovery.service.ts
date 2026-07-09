/**
 * Local recovery actions for the sync subsystem.
 *
 * - retryEntry: resets PERMANENT_FAILURE → PENDING. For SALE_CONFIRMATION /
 *   SHIFT_CLOSURE, regenerates payload from current DB state (re-snapshot);
 *   for other types, reuses original payload.
 * - discardEntry: marks PERMANENT_FAILURE → DISCARDED, excluded from future
 *   push cycles. Server is NOT notified — discards are local-only.
 *
 * Both operations use optimistic concurrency (transaction with status check)
 * and write an audit row to SyncRecoveryLog.
 */

import crypto from 'node:crypto';
import type { PrismaClient } from '@pharmacy/database/local';
import { DomainError } from '../../common/domain-error';

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

export class EntryNotReplayableException extends DomainError {
  constructor(entryId: string, reason: string) {
    super(
      'ENTRY_NOT_REPLAYABLE',
      `Sync entry ${entryId} cannot be replayed: ${reason}. Use Discard instead.`,
    );
  }
}

/**
 * Regenerates a fresh payload + hash from current local DB state.
 * Returns null when the operation is no longer replayable (e.g. annulled sale).
 */
export type PayloadSnapshotGenerator = (
  entryId: string,
  existingPayload: Record<string, unknown>,
  operationUuid: string,
  prisma: PrismaClient,
) => Promise<{ payload: Record<string, unknown>; payloadHash: string } | null>;

export interface SyncRecoveryService {
  retryEntry(
    entryId: string,
    actorUserId: string,
  ): Promise<{ id: string; status: string; payloadResnapshotted: boolean }>;

  discardEntry(
    entryId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ id: string; status: string }>;
}

export interface SyncRecoveryServiceConfig {
  prisma: PrismaClient;
  snapshotGenerators?: Partial<Record<string, PayloadSnapshotGenerator>>;
}

export const createSyncRecoveryService = (
  config: SyncRecoveryServiceConfig,
): SyncRecoveryService =>
  new SyncRecoveryServiceImpl(config.prisma, config.snapshotGenerators ?? {});

class SyncRecoveryServiceImpl implements SyncRecoveryService {
  private static readonly RE_SNAPSHOT_TYPES = new Set([
    'SALE_CONFIRMATION',
    'SHIFT_CLOSURE',
  ]);

  private static readonly REUSE_PAYLOAD_TYPES = new Set([
    'CLIENT_RETURN',
    'INVENTORY_ADJUSTMENT',
    'PRESCRIPTION_REGISTRATION',
  ]);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly snapshotGenerators: Partial<Record<string, PayloadSnapshotGenerator>>,
  ) {}

  async retryEntry(
    entryId: string,
    actorUserId: string,
  ): Promise<{ id: string; status: string; payloadResnapshotted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.syncQueue.findUnique({
        where: { id: entryId },
        select: {
          id: true, status: true, operationType: true,
          payload: true, payloadHash: true, operationUuid: true,
        },
      });

      if (!entry) throw new EntryNotInPermanentFailureException(entryId, 'NOT_FOUND');
      if (entry.status !== 'PERMANENT_FAILURE') {
        throw new EntryNotInPermanentFailureException(entryId, entry.status);
      }

      let payloadResnapshotted = false;
      let newPayload: string | undefined;
      let newPayloadHash: string | undefined;
      const { operationType } = entry;

      if (SyncRecoveryServiceImpl.RE_SNAPSHOT_TYPES.has(operationType)) {
        const generator = this.snapshotGenerators[operationType];
        const existingPayload = JSON.parse(entry.payload) as Record<string, unknown>;

        if (!generator) {
          // The caller must register snapshot generators for these types;
          // reusing the original payload would replay the same rejection.
          throw new EntryNotReplayableException(
            entryId,
            `A snapshot generator for ${operationType} is not registered. ` +
            'Retry cannot proceed until the application provides one.',
          );
        }

        const result = await generator(entryId, existingPayload, entry.operationUuid, this.prisma);
        if (result === null) {
          throw new EntryNotReplayableException(
            entryId,
            `The ${operationType} operation is no longer supported by current local data. ` +
            'The sale may have been annulled or the shift already closed.',
          );
        }
        newPayload = JSON.stringify(result.payload);
        newPayloadHash = result.payloadHash;
        payloadResnapshotted = true;
      } else if (SyncRecoveryServiceImpl.REUSE_PAYLOAD_TYPES.has(operationType)) {
        // These represent a point-in-time operator decision; re-snapshotting
        // would change the operation's meaning.
        newPayload = entry.payload;
        newPayloadHash = entry.payloadHash;
      } else {
        throw new EntryNotReplayableException(
          entryId,
          `Unknown operation type "${operationType}". Cannot determine re-snapshot policy.`,
        );
      }

      const updateData: Record<string, unknown> = {
        status: 'PENDING',
        retryCount: 0,
        failureCategory: null,
        lastErrorMessage: null,
        nextRetryAt: new Date(),
        lastAttemptAt: null,
      };
      if (newPayload !== undefined) {
        updateData.payload = newPayload;
        updateData.payloadSize = newPayload.length;
      }
      if (newPayloadHash !== undefined) {
        updateData.payloadHash = newPayloadHash;
      }

      try {
        // Where clause acts as optimistic lock — Prisma throws P2025 if status changed
        const updated = await tx.syncQueue.update({
          where: { id: entryId, status: 'PERMANENT_FAILURE' },
          data: updateData,
        });

        await tx.syncRecoveryLog.create({
          data: {
            id: crypto.randomUUID(),
            syncQueueEntryId: entryId,
            action: 'RETRY',
            reason: payloadResnapshotted ? 'Payload re-snapshotted from current DB state' : null,
            actorUserId,
            at: new Date(),
          },
        });

        return { id: updated.id, status: updated.status, payloadResnapshotted };
      } catch (err: unknown) {
        if (isPrismaNotFound(err)) throw new EntryStateChangedException(entryId);
        throw err;
      }
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

      if (!entry) throw new EntryStateChangedException(entryId);
      if (entry.status !== 'PERMANENT_FAILURE') {
        throw new EntryNotInPermanentFailureException(entryId, entry.status);
      }

      try {
        const updated = await tx.syncQueue.update({
          where: { id: entryId, status: 'PERMANENT_FAILURE' },
          data: { status: 'DISCARDED', lastErrorMessage: `DISCARDED: ${reason}` },
        });

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
      } catch (err: unknown) {
        if (isPrismaNotFound(err)) throw new EntryStateChangedException(entryId);
        throw err;
      }
    });
  }
}

function isPrismaNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2025'
  );
}
