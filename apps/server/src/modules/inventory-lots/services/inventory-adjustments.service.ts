import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, AdjustmentState, MovementType, LotState } from '@pharmacy/database';
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

interface AdjustmentItemPrep {
  lotId: string;
  movementType: MovementType;
  quantity: number;
  previousStock: number;
  resultingStock: number;
  reason?: string;
}

interface LotWithMovement {
  movement: { movementType: MovementType; quantity: number; lotId: string; previousStock: number };
  lot: { id: string; currentStock: number; version: number; state: LotState };
}

@Injectable()
export class InventoryAdjustmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryInventoryAdjustmentDto): Promise<any> {
    const where: Prisma.InventoryAdjustmentDocumentWhereInput = {};
    if (query.state) where.state = query.state as AdjustmentState;
    if (query.createdAtFrom || query.createdAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.createdAtFrom) dateFilter.gte = new Date(query.createdAtFrom);
      if (query.createdAtTo) dateFilter.lte = new Date(query.createdAtTo);
      where.createdAt = dateFilter;
    }

    const [docs, total] = await this.prisma.$transaction([
      this.prisma.inventoryAdjustmentDocument.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
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
  ): Promise<any> {
    // Business validation: at least one adjustment item is required.
    // Relocated from CreateInventoryAdjustmentSchema (HTTP DTO) to the service
    // layer so that sync dispatcher replays are also protected.
    if (!createDto.items || createDto.items.length === 0) {
      throw new Error('At least one item is required for an inventory adjustment');
    }

    return this.prisma.$transaction(async (tx) => {
      const itemsData = await this.prepareAdjustmentItems(tx, createDto.items);
      const sequentialNumber = await this.getNextSequentialNumber(tx);
      const doc = await tx.inventoryAdjustmentDocument.create({
        data: {
          id: crypto.randomUUID(),
          sequentialNumber,
          reason: createDto.reason,
          notes: createDto.notes,
          createdByUserId: userId,
          physicalCountId: physicalCountId ?? null,
        },
      });
      // Create movements separately: InventoryMovement has adjustmentDocumentId as a scalar
      // with no Prisma-level relation declared.
      const movements = await Promise.all(
        itemsData.map((m) =>
          tx.inventoryMovement.create({
            data: {
              id: crypto.randomUUID(),
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
        ),
      );
      return { ...doc, movements };
    });
  }

  async submit(id: string, userId: string): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({ where: { id } });
    if (!doc) throw new AdjustmentNotFoundException(id);
    if (doc.state !== AdjustmentState.DRAFT) throw new AdjustmentNotDraftException(id);

    return this.prisma.inventoryAdjustmentDocument.update({
      where: { id },
      data: {
        state: AdjustmentState.PENDING_APPROVAL,
        submittedForApprovalAt: new Date(),
      },
    });
  }

  async approve(id: string, userId: string, dto: ApproveInventoryAdjustmentDto): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({ where: { id } });
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

  async reject(id: string, userId: string, dto: RejectInventoryAdjustmentDto): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({ where: { id } });
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

  async apply(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<any> {
    const executor = async (client: Prisma.TransactionClient) => {
      const doc = await client.inventoryAdjustmentDocument.findUnique({
        where: { id },
      });
      if (!doc) throw new AdjustmentNotFoundException(id);
      if (doc.state !== AdjustmentState.APPROVED) throw new AdjustmentNotApprovedException(id);

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

  async annul(id: string, userId: string, dto: AnnulInventoryAdjustmentDto): Promise<any> {
    const doc = await this.prisma.inventoryAdjustmentDocument.findUnique({ where: { id } });
    if (!doc) throw new AdjustmentNotFoundException(id);
    if (doc.state === AdjustmentState.APPLIED) throw new AdjustmentNotAnnullableException(id);

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
  ): Promise<AdjustmentItemPrep[]> {
    return Promise.all(
      items.map(async (item) => {
        const lot = await tx.lot.findUnique({ where: { id: item.lotId } });
        if (!lot) throw new LotNotFoundException(item.lotId);

        if (item.movementType === MovementType.NEGATIVE_ADJUSTMENT && item.quantity > lot.currentStock) {
          throw new InsufficientStockForAdjustmentException(item.lotId, item.quantity, lot.currentStock);
        }

        const signedQuantity = item.movementType === MovementType.NEGATIVE_ADJUSTMENT
          ? -item.quantity
          : item.quantity;

        return {
          lotId: lot.id,
          movementType: item.movementType,
          quantity: item.quantity,
          previousStock: lot.currentStock,
          resultingStock: lot.currentStock + signedQuantity,
          reason: item.reason,
        };
      }),
    );
  }

  private async verifyAndLoadLots(
    tx: Prisma.TransactionClient,
    documentId: string,
    movements: Array<{ lotId: string; previousStock: number; movementType: MovementType; quantity: number }>,
  ): Promise<LotWithMovement[]> {
    return Promise.all(
      movements.map(async (movement) => {
        const lot = await tx.lot.findUnique({ where: { id: movement.lotId } });
        if (!lot) throw new LotNotFoundException(movement.lotId);
        if (lot.currentStock !== movement.previousStock) {
          throw new StaleAdjustmentException(documentId, movement.lotId, movement.previousStock, lot.currentStock);
        }
        return { movement, lot };
      }),
    );
  }

  private async applyMovementToLot(
    tx: Prisma.TransactionClient,
    movement: { movementType: MovementType; quantity: number; lotId: string },
    lot: { currentStock: number; version: number; state: LotState },
  ): Promise<void> {
    const isNegative = movement.movementType === MovementType.NEGATIVE_ADJUSTMENT;
    const newStock = lot.currentStock + (isNegative ? -movement.quantity : movement.quantity);
    const newState = newStock === 0
      ? LotState.EXHAUSTED
      : (lot.currentStock === 0 && newStock > 0 ? LotState.ACTIVE : lot.state);

    const updated = await tx.lot.updateMany({
      where: { id: movement.lotId, version: lot.version },
      data: { currentStock: newStock, version: { increment: 1 }, state: newState },
    });
    if (updated.count === 0) throw new ConcurrentStockModificationException(movement.lotId);
  }

  private async getNextSequentialNumber(tx: Prisma.TransactionClient): Promise<number> {
    const latest = await tx.inventoryAdjustmentDocument.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latest?.sequentialNumber || 0) + 1;
  }
}
