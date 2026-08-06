import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { SyncBatchDto } from '../dto/sync-batch.dto';
import { QuerySyncQueueDto } from '../dto/query-sync-queue.dto';
import {
  SyncOperationDispatcherService,
  type DispatchResult,
} from '../sync-operation-dispatcher.service';

/** Shape of a single entry in the POST /sync/batch response. */
export interface BatchOperationResult {
  operationUuid: string;
  status: 'ACCEPTED' | 'ALREADY_ACCEPTED' | 'REJECTED';
  error?: string;
  /** Server-assigned id of the entity created by a *_CREATION handler. */
  entityId?: string;
  /**
   * Server-chosen `internalCode` for PRODUCT_CREATION. Absent for every
   * other operation type and for REJECTED results.
   */
  entityInternalCode?: string;
}

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService,
    private dispatcher: SyncOperationDispatcherService,
    private tenantContext: TenantContextService,
  ) {}

  /**
   * Accepts a batch of offline operations. Each item is independently validated
   * (hash check, duplicate-uuid guard) and inserted as PENDING. A single bad
   * item does not reject the rest of the batch. sourceWorkstationId is taken
   * from the authenticated session, never from the request body.
   *
   * Operations that require immediate visibility (PRODUCT_CREATION,
   * PRODUCT_UPDATE) are dispatched synchronously after insertion so that a
   * subsequent catalog pull sees the updated data rather than stale server
   * state.  If immediate dispatch fails the entry remains PENDING for the
   * background job to retry.
   *
   * The per-operation result includes `entityId` and `entityInternalCode`
   * for `*_CREATION` operations so the POS can stamp `serverId` (and the
   * server-chosen `internalCode` that replaced the offline provisional
   * value) on its local rows in the same transaction that marks the
   * SyncQueue entry COMPLETED. Without these fields, the
   * `assertProductsSynced` / `assertClientsSynced` gates would block
   * sales of cashier-created entities until the next full pull.
   */
  async receiveBatch(
    batchDto: SyncBatchDto,
    sourceWorkstationId: string,
  ): Promise<BatchOperationResult[]> {
    // Operations are independent (each validates, inserts its own queue row
    // and optionally dispatches), so process them in a bounded worker pool
    // instead of fully sequentially — batch latency no longer scales 1:1
    // with operation count. Duplicate operationUuids within one batch race
    // safely: the loser hits the unique constraint and surfaces as
    // ALREADY_ACCEPTED via the P2002 handler in ingestOperation.
    const operations = batchDto.operations;
    const results: BatchOperationResult[] = new Array(operations.length);
    const WORKERS = 5;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex++;
        if (index >= operations.length) return;
        results[index] = await this.ingestOperation(
          operations[index],
          sourceWorkstationId,
        );
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(WORKERS, operations.length) },
        () => worker(),
      ),
    );

    return results;
  }

  /** Returns the calling workstation's pending and failed queue counts. */
  async getStatus(sourceWorkstationId: string): Promise<any> {
    const [pending, failed] = await Promise.all([
      this.prisma.syncQueue.count({
        where: { sourceWorkstationId, status: 'PENDING' },
      }),
      this.prisma.syncQueue.count({
        where: { sourceWorkstationId, status: 'FAILED' },
      }),
    ]);
    return { sourceWorkstationId, pending, failed };
  }

  /**
   * Returns the highest clientSequence persisted for a given source workstation,
   * or null when the server has not received any operations from it yet.
   */
  async getMaxClientSequence(sourceWorkstationId: string): Promise<number | null> {
    const aggregate = await this.prisma.syncQueue.aggregate({
      _max: { clientSequence: true },
      where: { sourceWorkstationId },
    });

    return aggregate._max.clientSequence === null
      ? null
      : Number(aggregate._max.clientSequence);
  }

  /** Paginated queue listing, optionally filtered by status and operationType. */
  async findAll(query: QuerySyncQueueDto): Promise<any> {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.operationType) where.operationType = query.operationType;

    const [data, total] = await Promise.all([
      this.prisma.syncQueue.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.syncQueue.count({ where }),
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  /** Returns a single queue entry by ID. */
  async findOne(id: string): Promise<any> {
    return this.prisma.syncQueue.findUnique({ where: { id } });
  }

  /** Resets a FAILED entry back to PENDING and clears the retry timer. */
  async retry(id: string): Promise<any> {
    const entry = await this.prisma.syncQueue.findUnique({
      where: { id },
    });
    if (!entry) return null;

    return this.prisma.syncQueue.update({
      where: { id },
      data: { status: 'PENDING', nextRetryAt: null, lastErrorMessage: null },
    });
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Operation types that can be dispatched synchronously for immediate visibility. */
  private readonly IMMEDIATE_DISPATCH_TYPES = new Set([
    'PRODUCT_CREATION',
    'PRODUCT_UPDATE',
  ]);

  /**
   * Operation types whose handler returns a server-assigned entityId
   * (and, for PRODUCT_CREATION, the server-chosen internalCode). Every
   * other type returns the bare `{ operationUuid, status }` shape.
   */
  private readonly CREATION_TYPES = new Set<string>([
    'PRODUCT_CREATION',
    'CLIENT_CREATION',
  ]);

  /**
   * Validates hash, guards duplicates, inserts a single operation as PENDING.
   * Operations in IMMEDIATE_DISPATCH_TYPES are additionally dispatched
   * synchronously so a subsequent pull (e.g. catalog) sees the latest data.
   * For `*_CREATION` operations the result includes the server-assigned
   * entityId (and `entityInternalCode` for PRODUCT_CREATION) so the POS
   * can stamp its local row in the same transaction.
   */
  private async ingestOperation(op: any, sourceWorkstationId: string): Promise<BatchOperationResult> {
    const computedHash = this.computePayloadHash(op.payload);
    if (computedHash !== op.payloadHash) {
      return { operationUuid: op.operationUuid, status: 'REJECTED', error: 'PAYLOAD_HASH_MISMATCH' };
    }

    try {
      const entryId = await this.createQueueEntry(op, sourceWorkstationId);

      if (this.IMMEDIATE_DISPATCH_TYPES.has(op.operationType)) {
        const dispatchResult = await this.tryImmediateDispatch(entryId, op, sourceWorkstationId);
        if (
          dispatchResult !== null &&
          this.CREATION_TYPES.has(op.operationType)
        ) {
          return {
            operationUuid: op.operationUuid,
            status: 'ACCEPTED',
            entityId: dispatchResult.entityId,
            entityInternalCode: dispatchResult.entityInternalCode,
          };
        }
      }

      return { operationUuid: op.operationUuid, status: 'ACCEPTED' };
    } catch (error: any) {
      if (error.code === 'P2002') {
        // The same operationUuid was already inserted — surface the
        // server-assigned entityId / entityInternalCode that the previous
        // successful dispatch stamped on the row, so a retry whose first
        // response was lost can still recover serverId locally.
        const previous = await this.prisma.syncQueue.findUnique({
          where: { operationUuid: op.operationUuid },
          select: { entityId: true, entityInternalCode: true },
        });
        const result: BatchOperationResult = {
          operationUuid: op.operationUuid,
          status: 'ALREADY_ACCEPTED',
        };
        if (previous?.entityId) {
          result.entityId = previous.entityId;
          if (previous.entityInternalCode) {
            result.entityInternalCode = previous.entityInternalCode;
          }
        }
        return result;
      }
      return { operationUuid: op.operationUuid, status: 'REJECTED', error: error.message ?? 'INTERNAL_ERROR' };
    }
  }

  /**
   * Attempts synchronous dispatch of a just-inserted operation.  If the
   * handler succeeds the queue entry is marked COMPLETED and the
   * dispatcher's `entityId` / `entityInternalCode` are stamped on the
   * row.  If the handler throws a `DomainException` (validation,
   * not-found, business-rule violation — anything the domain layer
   * flagged as deterministic and non-retryable) the row is marked
   * FAILED without `nextRetryAt` and the error is re-thrown so the
   * caller can surface a `REJECTED` batch result; the POS then moves
   * its local row to `PERMANENT_FAILURE` and stops re-sending.  Any
   * other error (raw DB / network / framework exception) is treated
   * as transient: the row stays PENDING and the background cron job
   * will retry it.
   */
  private async tryImmediateDispatch(
    entryId: string,
    op: any,
    sourceWorkstationId: string,
  ): Promise<DispatchResult | null> {
    const entry: import('../entities/sync-queue-entry.entity').SyncQueueEntry = {
      id: entryId,
      subscriptionId: this.tenantContext.getSubscriptionId(),
      operationUuid: op.operationUuid,
      operationType: op.operationType as import('../entities/sync-queue-entry.entity').SyncQueueEntry['operationType'],
      payload: JSON.stringify(op.payload),
      sourceWorkstationId,
      retryCount: 0,
      status: 'PENDING',
      operationSource: op.source ?? 'DIRECT',
      lastErrorMessage: null,
      nextRetryAt: null,
      correlationId: null,
    };

    try {
      const result = await this.dispatcher.dispatch(entry);
      await this.prisma.syncQueue.update({
        where: { id: entryId },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          entityId: result.entityId ?? null,
          entityInternalCode: result.entityInternalCode ?? null,
        },
      });
      return result;
    } catch (error: unknown) {
      if (error instanceof DomainException) {
        // Permanent error — mark the row FAILED without a retry
        // schedule so the cron job does not pick it up.  Re-throw so
        // the batch response carries `status: 'REJECTED'` and the POS
        // transitions its local row to PERMANENT_FAILURE.
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.prisma.syncQueue.update({
          where: { id: entryId },
          data: {
            status: 'FAILED',
            lastErrorMessage: errorMessage,
          },
        });
        throw error;
      }
      // Transient — leave the row PENDING and let the background cron
      // job retry on its 30s tick.
      return null;
    }
  }

  /**
   * Inserts a new PENDING SyncQueue record.
   * Returns the created entry id.
   */
  private async createQueueEntry(op: any, sourceWorkstationId: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.prisma.syncQueue.create({
      data: {
        id,
        subscriptionId: this.tenantContext.getSubscriptionId(),
        operationUuid: op.operationUuid,
        operationType: op.operationType,
        payload: JSON.stringify(op.payload),
        payloadHash: op.payloadHash,
        payloadSize: JSON.stringify(op.payload).length,
        sourceWorkstationId,
        sourceCreatedAt: new Date(op.sourceCreatedAt),
        clientSequence: op.clientSequence,
        receivedAt: new Date(),
        status: 'PENDING',
        operationSource: op.source ?? 'DIRECT',
      },
    });
    return id;
  }

  /** Computes a SHA-256 hex digest of a JSON-stringified value. */
  private computePayloadHash(payload: Record<string, any>): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
