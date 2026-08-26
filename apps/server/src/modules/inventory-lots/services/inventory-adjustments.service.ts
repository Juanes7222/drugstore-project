import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import {
  Prisma,
  AdjustmentState,
  MovementType,
  LotState,
} from '@pharmacy/database';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';
import * as crypto from 'crypto';
import {
  CreateInventoryAdjustmentDto,
  CreateInventoryAdjustmentItemDto,
} from '../dto/create-inventory-adjustment.dto';
import { QueryInventoryAdjustmentDto } from '../dto/query-inventory-adjustment.dto';
import { ApproveInventoryAdjustmentDto } from '../dto/approve-inventory-adjustment.dto';
import { RejectInventoryAdjustmentDto } from '../dto/reject-inventory-adjustment.dto';
import { AnnulInventoryAdjustmentDto } from '../dto/annul-inventory-adjustment.dto';
import { AdjustmentNotFoundException } from '../exceptions/adjustment-not-found.exception';
import { AdjustmentNotDraftException } from '../exceptions/adjustment-not-draft.exception';
import { AdjustmentNotPendingApprovalException } from '../exceptions/adjustment-not-pending-approval.exception';
import { AdjustmentNotApprovedException } from '../exceptions/adjustment-not-approved.exception';
import { AdjustmentNotAnnullableException } from '../exceptions/adjustment-not-annullable.exception';
import { InsufficientStockForAdjustmentException } from '../exceptions/insufficient-stock-for-adjustment.exception';
import { StaleAdjustmentException } from '../exceptions/stale-adjustment.exception';
import { ConcurrentStockModificationException } from '../exceptions/concurrent-stock-modification.exception';
import { LotNotFoundException } from '../exceptions/lot-not-found.exception';
import { LotsService } from './lots.service';
import type { LotSyncData } from '@/modules/sync/dto/purchase-sync-payloads';

interface AdjustmentItemPrep {
  lotId: string;
  movementType: MovementType;
  quantity: number;
  previousStock: number;
  resultingStock: number;
  reason?: string;
}

interface LotWithMovement {
  movement: {
    movementType: MovementType;
    quantity: number;
    lotId: string;
    previousStock: number;
  };
  lot: { id: string; currentStock: number; version: number; state: LotState };
}

@Injectable()
export class InventoryAdjustmentsService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(query: QueryInventoryAdjustmentDto): Promise<any> {
    const where: Prisma.InventoryAdjustmentDocumentWhereInput = {};
    if (query.state) where.state = query.state as AdjustmentState;
    if (query.createdAtFrom || query.createdAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.createdAtFrom) dateFilter.gte = new Date(query.createdAtFrom);
      if (query.createdAtTo) dateFilter.lte = new Date(query.createdAtTo);
      where.createdAt = dateFilter;
    }

    if (query.cursor) {
      const page = await paginateWithCursor<
        unknown,
        Prisma.InventoryAdjustmentDocumentWhereInput,
        Prisma.InventoryAdjustmentDocumentOrderByWithRelationInput
      >({
        model: this.prisma.inventoryAdjustmentDocument,
        baseWhere: where,
        limit: query.pageSize,
        cursor: query.cursor,
        timeField: 'createdAt',
        direction: 'desc',
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return {
        data: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        pageSize: query.pageSize,
      };
    }

    const [docs, total] = await Promise.all([
      this.prisma.inventoryAdjustmentDocument.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.inventoryAdjustmentDocument.count({ where }),
    ]);
    return { data: docs, total, page: query.page, pageSize: query.pageSize };
  }

  async findById(id: string): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new AdjustmentNotFoundException(id);
    // Fetch movements separately: InventoryMovement has adjustmentDocumentId as a scalar
    // with no Prisma-level relation declared.
    const movements = await this.prisma.inventoryMovement.findMany({
      where: { adjustmentDocumentId: id },
      include: { lot: true },
    });
    return { ...doc, movements };
  }

  async create(
    createDto: CreateInventoryAdjustmentDto,
    userId: string,
    physicalCountId?: string,
    syncLotContext?: Map<string, LotSyncData>,
  ): Promise<any> {
    // Business validation: at least one adjustment item is required.
    if (!createDto.items || createDto.items.length === 0) {
      throw new Error(
        'At least one item is required for an inventory adjustment',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const itemsData = await this.prepareAdjustmentItems(
        tx,
        createDto.items,
        syncLotContext,
      );
      const sequentialNumber = await this.getNextSequentialNumber(tx);
      const doc = await tx.inventoryAdjustmentDocument.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
          sequentialNumber,
          reason: createDto.reason,
          notes: createDto.notes,
          createdByUserId: userId,
          physicalCountId: physicalCountId ?? null,
        },
      });
      // Create movements separately: InventoryMovement has adjustmentDocumentId as a scalar
      // with no Prisma-level relation declared.
      // Sequential — see prepareAdjustmentItems for adapter-pg reason.
      const movements: any[] = [];
      for (const m of itemsData) {
        movements.push(
          await tx.inventoryMovement.create({
            data: {
              id: crypto.randomUUID(),
              subscriptionId: this.tenantContext.getSubscriptionId(),
              lotId: m.lotId,
              movementType: m.movementType,
              quantity: m.quantity,
              previousStock: m.previousStock,
              resultingStock: m.resultingStock,
              createdById: userId,
              createdAt: new Date(),
              reason: m.reason,
              adjustmentDocumentId: doc.id,
            },
          }),
        );
      }
      return { ...doc, movements };
    });
  }

  async submit(id: string, userId: string): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new AdjustmentNotFoundException(id);
    if (doc.state !== AdjustmentState.DRAFT)
      throw new AdjustmentNotDraftException(id);

    return this.prisma.inventoryAdjustmentDocument.update({
      where: { id },
      data: {
        state: AdjustmentState.PENDING_APPROVAL,
        submittedForApprovalAt: new Date(),
      },
    });
  }

  async approve(
    id: string,
    userId: string,
    dto: ApproveInventoryAdjustmentDto,
  ): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new AdjustmentNotFoundException(id);
    if (doc.state !== AdjustmentState.PENDING_APPROVAL) {
      throw new AdjustmentNotPendingApprovalException(id);
    }

    return this.prisma.inventoryAdjustmentDocument.update({
      where: { id },
      data: {
        state: AdjustmentState.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: userId,
        approvalNotes: dto.approvalNotes,
      },
    });
  }

  async reject(
    id: string,
    userId: string,
    dto: RejectInventoryAdjustmentDto,
  ): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new AdjustmentNotFoundException(id);
    if (doc.state !== AdjustmentState.PENDING_APPROVAL) {
      throw new AdjustmentNotPendingApprovalException(id);
    }

    return this.prisma.inventoryAdjustmentDocument.update({
      where: { id },
      data: {
        state: AdjustmentState.REJECTED,
        rejectedAt: new Date(),
        rejectedByUserId: userId,
        rejectionReason: dto.rejectionReason,
      },
    });
  }

  async apply(
    id: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const executor = async (client: Prisma.TransactionClient) => {
      const doc = await client.inventoryAdjustmentDocument.findUnique({
        where: { id },
      });
      if (!doc) throw new AdjustmentNotFoundException(id);
      if (doc.state !== AdjustmentState.APPROVED)
        throw new AdjustmentNotApprovedException(id);

      // Fetch movements separately: InventoryMovement has adjustmentDocumentId as a scalar
      // with no Prisma-level relation declared.
      const movements = await client.inventoryMovement.findMany({
        where: { adjustmentDocumentId: id },
      });

      // Pre-flight: verify every lot matches its previousStock snapshot before mutating any
      const lots = await this.verifyAndLoadLots(client, doc.id, movements);

      // All preconditions passed: apply every movement
      for (const { movement, lot } of lots) {
        await this.applyMovementToLot(client, movement, lot);
      }

      return client.inventoryAdjustmentDocument.update({
        where: { id },
        data: { state: AdjustmentState.APPLIED, appliedAt: new Date() },
      });
    };

    if (tx) return executor(tx);
    return this.prisma.$transaction(executor);
  }

  async annul(
    id: string,
    userId: string,
    dto: AnnulInventoryAdjustmentDto,
  ): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new AdjustmentNotFoundException(id);
    if (doc.state === AdjustmentState.APPLIED)
      throw new AdjustmentNotAnnullableException(id);

    return this.prisma.inventoryAdjustmentDocument.update({
      where: { id },
      data: {
        state: AdjustmentState.ANNULLED,
        annulledAt: new Date(),
        annulledByUserId: userId,
        annulmentReason: dto.annulmentReason,
      },
    });
  }

  private async prepareAdjustmentItems(
    tx: Prisma.TransactionClient,
    items: CreateInventoryAdjustmentItemDto[],
    syncLotContext?: Map<string, LotSyncData>,
  ): Promise<AdjustmentItemPrep[]> {
    // Sequential: @prisma/adapter-pg uses a single pg connection per
    // interactive transaction — concurrent queries on that connection
    // trigger "client.query() already executing" (pg@9 deprecation) and
    // abort the transaction (25P02). See sales.service.create for same pattern.
    const result: AdjustmentItemPrep[] = [];
    for (const item of items) {
      let lotData = syncLotContext?.get(item.lotId);

      // Legacy payloads (before POS refactor e631860) may omit lot data.
      // When that happens, try to hydrate from any available source.
      if (!lotData) {
        // Attempt to extract productId from item.lot (new format) or
        // item.productId (some old payload variants have it at item level)
        const productIdFromItem =
          (item as any).lot?.productId ?? (item as any).productId;
        if (productIdFromItem) {
          lotData = {
            productId: productIdFromItem,
            batchNumber: 'UNKNOWN',
            expirationDate: new Date().toISOString(),
            currentStock: 0,
          };
        } else if (typeof (tx as any).product?.findFirst === 'function') {
          // Last resort: pick the first active product from catalog
          const fallbackProduct = await tx.product.findFirst({
            where: { isActive: true },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          if (fallbackProduct) {
            lotData = {
              productId: fallbackProduct.id,
              batchNumber: 'SYNC-UNKNOWN',
              expirationDate: new Date().toISOString(),
              currentStock: 0,
            };
          }
        }
      }

      const lot = await this.lotsService.resolveLotForSync(
        tx,
        item.lotId,
        lotData,
      );

      if (
        item.movementType === MovementType.NEGATIVE_ADJUSTMENT &&
        item.quantity > lot.currentStock
      ) {
        throw new InsufficientStockForAdjustmentException(
          item.lotId,
          item.quantity,
          lot.currentStock,
        );
      }

      const signedQuantity =
        item.movementType === MovementType.NEGATIVE_ADJUSTMENT
          ? -item.quantity
          : item.quantity;

      result.push({
        lotId: lot.id,
        movementType: item.movementType,
        quantity: item.quantity,
        previousStock: lot.currentStock,
        resultingStock: lot.currentStock + signedQuantity,
        reason: item.reason,
      });
    }
    return result;
  }

  private async verifyAndLoadLots(
    tx: Prisma.TransactionClient,
    documentId: string,
    movements: Array<{
      lotId: string;
      previousStock: number;
      movementType: MovementType;
      quantity: number;
    }>,
  ): Promise<LotWithMovement[]> {
    // Sequential for same adapter-pg reason as prepareAdjustmentItems.
    const result: LotWithMovement[] = [];
    for (const movement of movements) {
      const lot = await tx.lot.findUnique({ where: { id: movement.lotId } });
      if (!lot) throw new LotNotFoundException(movement.lotId);
      if (lot.currentStock !== movement.previousStock) {
        throw new StaleAdjustmentException(
          documentId,
          movement.lotId,
          movement.previousStock,
          lot.currentStock,
        );
      }
      result.push({ movement, lot });
    }
    return result;
  }

  private async applyMovementToLot(
    tx: Prisma.TransactionClient,
    movement: { movementType: MovementType; quantity: number; lotId: string },
    lot: { currentStock: number; version: number; state: LotState },
  ): Promise<void> {
    const isNegative =
      movement.movementType === MovementType.NEGATIVE_ADJUSTMENT;
    const newStock =
      lot.currentStock + (isNegative ? -movement.quantity : movement.quantity);
    const newState =
      newStock === 0
        ? LotState.EXHAUSTED
        : lot.currentStock === 0 && newStock > 0
          ? LotState.ACTIVE
          : lot.state;

    const updated = await tx.lot.updateMany({
      where: { id: movement.lotId, version: lot.version },
      data: {
        currentStock: newStock,
        version: { increment: 1 },
        state: newState,
      },
    });
    if (updated.count === 0)
      throw new ConcurrentStockModificationException(movement.lotId);
  }

  /**
   * Returns the next sequentialNumber for an InventoryAdjustmentDocument.
   *
   * Uses an atomic `increment` on the single-row InventoryAdjustmentCounter so
   * concurrent transactions serialize at the DB level — each `update` takes a
   * row lock and reads the post-increment value, guaranteeing unique numbers
   * even when the sync cron job and the UI endpoint (or multiple app
   * instances) create adjustments at the same time. This mirrors the
   * consecutive-allocation pattern in FiscalResolutionAllocationsService.
   *
   * On first creation the counter seeds from MAX(sequentialNumber) among
   * existing documents — otherwise a hardcoded initial value would collide
   * with records that were created before the counter table existed.
   */
  private async getNextSequentialNumber(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const maxSeq =
      (
        await tx.inventoryAdjustmentDocument.aggregate({
          _max: { sequentialNumber: true },
        })
      )._max.sequentialNumber ?? 0;

    const counter = await tx.inventoryAdjustmentCounter.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', lastSequentialNumber: maxSeq + 1 },
      update: { lastSequentialNumber: { increment: 1 } },
    });

    return counter.lastSequentialNumber;
  }
}
