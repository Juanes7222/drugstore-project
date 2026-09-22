/**
 * Auto-repair for sync operations that failed permanently because a
 * dependency did not exist on the server yet (offline-first ordering gap).
 *
 * A SALE_CONFIRMATION can reach the server before the CLIENT_CREATION,
 * PRODUCT_CREATION or PURCHASE_RECEPTION_CONFIRMATION that materializes the
 * client/product/lot it references. The dispatcher marks those sales
 * PERMANENT_FAILURE (a DomainException "not found" is non-transient by
 * design), and nothing ever looked at them again — the sale was silently
 * lost even though the POS had already confirmed it to the pharmacist.
 *
 * Whenever a dispatcher handler materializes one of those entities, this
 * service requeues the failed entries whose payload references it. Requeued
 * entries go back through the idempotent dispatcher, so a sale replay now
 * finds its dependency and completes. Entries whose dependency never arrives
 * stay failed — this only widens the retry window, it never invents data.
 *
 * Matching is deliberately strict (uuid or explicit "contains the local id
 * marker") to avoid reviving entries that failed for an unrelated reason.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SyncStatus } from '@pharmacy/database';

const REQUEUEABLE_STATUSES: SyncStatus[] = [
  SyncStatus.PERMANENT_FAILURE,
  SyncStatus.FAILED,
];

/** Operation types whose failure can be caused by a missing dependency. */
const DEPENDENT_OPERATION_TYPES = [
  'SALE_CONFIRMATION',
  'CLIENT_RETURN',
  'INVENTORY_ADJUSTMENT',
  'SHIFT_CLOSURE',
  'SHIFT_OPEN',
] as const;

@Injectable()
export class SyncDependencyRequeueService {
  private readonly logger = new Logger(SyncDependencyRequeueService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Requeues failed operations that reference `entityId` in their payload.
   *
   * `entityId` is the id the DEPENDENT payloads carry (the POS-local id for
   * clients — sales reference the local client uuid — and the shared id for
   * products and lots, whose ids POS and server agree on).
   */
  async requeueDependentsOf(entityId: string): Promise<number> {
    if (!entityId) return 0;

    const candidates = await this.prisma.syncQueue.findMany({
      where: {
        operationType: { in: [...DEPENDENT_OPERATION_TYPES] },
        status: { in: REQUEUEABLE_STATUSES },
        payload: { contains: entityId },
      },
      select: { id: true, operationUuid: true, operationType: true },
      take: 50,
    });

    if (candidates.length === 0) return 0;

    await this.prisma.syncQueue.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: {
        status: SyncStatus.PENDING,
        retryCount: 0,
        nextRetryAt: null,
        lastErrorMessage: null,
      },
    });

    this.logger.log(
      `Dependency requeue: ${candidates.length} operation(s) revived after ` +
        `entity ${entityId} materialized (${candidates.map((c) => c.operationType).join(', ')})`,
    );
    return candidates.length;
  }
}
