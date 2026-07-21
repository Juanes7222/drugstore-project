import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SyncBatchDto } from '../dto/sync-batch.dto';
import { QuerySyncQueueDto } from '../dto/query-sync-queue.dto';
import { SyncOperationDispatcherService } from '../sync-operation-dispatcher.service';

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService,
    private dispatcher: SyncOperationDispatcherService,
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
   */
  async receiveBatch(
    batchDto: SyncBatchDto,
    sourceWorkstationId: string,
  ): Promise<any[]> {
    const results: any[] = [];
    for (const op of batchDto.operations) {
      results.push(
        await this.ingestOperation(op, sourceWorkstationId),
      );
    }
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
   * Validates hash, guards duplicates, inserts a single operation as PENDING.
   * Operations in IMMEDIATE_DISPATCH_TYPES are additionally dispatched
   * synchronously so a subsequent pull (e.g. catalog) sees the latest data.
   */
  private async ingestOperation(op: any, sourceWorkstationId: string): Promise<any> {
    const computedHash = this.computePayloadHash(op.payload);
    if (computedHash !== op.payloadHash) {
      return { operationUuid: op.operationUuid, status: 'REJECTED', error: 'PAYLOAD_HASH_MISMATCH' };
    }

    try {
      const entryId = await this.createQueueEntry(op, sourceWorkstationId);

      if (this.IMMEDIATE_DISPATCH_TYPES.has(op.operationType)) {
        await this.tryImmediateDispatch(entryId, op, sourceWorkstationId);
      }

      return { operationUuid: op.operationUuid, status: 'ACCEPTED' };
    } catch (error: any) {
      if (error.code === 'P2002') {
        return { operationUuid: op.operationUuid, status: 'ALREADY_ACCEPTED' };
      }
      return { operationUuid: op.operationUuid, status: 'REJECTED', error: error.message ?? 'INTERNAL_ERROR' };
    }
  }

  /**
   * Attempts synchronous dispatch of a just-inserted operation.  If the
   * handler succeeds the queue entry is marked COMPLETED; on failure it
   * stays PENDING so the background job can retry it.
   */
  private async tryImmediateDispatch(
    entryId: string,
    op: any,
    sourceWorkstationId: string,
  ): Promise<void> {
    const entry: import('../entities/sync-queue-entry.entity').SyncQueueEntry = {
      id: entryId,
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
      await this.dispatcher.dispatch(entry);
      await this.prisma.syncQueue.update({
        where: { id: entryId },
        data: { status: 'COMPLETED', processedAt: new Date() },
      });
    } catch {
      // Leave as PENDING – the background cron job will retry.
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
