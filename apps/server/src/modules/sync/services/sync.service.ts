import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SyncBatchDto } from '../dto/sync-batch.dto';
import { QuerySyncQueueDto } from '../dto/query-sync-queue.dto';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

  /**
   * Accepts a batch of offline operations. Each item is independently validated
   * (hash check, duplicate-uuid guard) and inserted as PENDING. A single bad
   * item does not reject the rest of the batch. sourceWorkstationId is taken
   * from the authenticated session, never from the request body.
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
      (this.prisma.syncQueue as any).count({
        where: { sourceWorkstationId, status: 'PENDING' },
      }),
      (this.prisma.syncQueue as any).count({
        where: { sourceWorkstationId, status: 'FAILED' },
      }),
    ]);
    return { sourceWorkstationId, pending, failed };
  }

  /** Paginated queue listing, optionally filtered by status and operationType. */
  async findAll(query: QuerySyncQueueDto): Promise<any> {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.operationType) where.operationType = query.operationType;

    const [data, total] = await Promise.all([
      (this.prisma.syncQueue as any).findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      (this.prisma.syncQueue as any).count({ where }),
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  /** Returns a single queue entry by ID. */
  async findOne(id: string): Promise<any> {
    return (this.prisma.syncQueue as any).findUnique({ where: { id } });
  }

  /** Resets a FAILED entry back to PENDING and clears the retry timer. */
  async retry(id: string): Promise<any> {
    const entry = await (this.prisma.syncQueue as any).findUnique({
      where: { id },
    });
    if (!entry) return null;

    return (this.prisma.syncQueue as any).update({
      where: { id },
      data: { status: 'PENDING', nextRetryAt: null, lastErrorMessage: null },
    });
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Validates hash, guards duplicates, inserts a single operation as PENDING. */
  private async ingestOperation(op: any, sourceWorkstationId: string): Promise<any> {
    const computedHash = this.computePayloadHash(op.payload);
    if (computedHash !== op.payloadHash) {
      return { operationUuid: op.operationUuid, status: 'REJECTED', error: 'PAYLOAD_HASH_MISMATCH' };
    }

    try {
      await this.createQueueEntry(op, sourceWorkstationId);
      return { operationUuid: op.operationUuid, status: 'ACCEPTED' };
    } catch (error: any) {
      if (error.code === 'P2002') {
        return { operationUuid: op.operationUuid, status: 'ALREADY_ACCEPTED' };
      }
      return { operationUuid: op.operationUuid, status: 'REJECTED', error: error.message ?? 'INTERNAL_ERROR' };
    }
  }

  /** Inserts a new PENDING SyncQueue record. */
  private async createQueueEntry(op: any, sourceWorkstationId: string): Promise<void> {
    await (this.prisma.syncQueue as any).create({
      data: {
        id: crypto.randomUUID(),
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
      },
    });
  }

  /** Computes a SHA-256 hex digest of a JSON-stringified value. */
  private computePayloadHash(payload: Record<string, any>): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
