import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, LotState, MovementType } from '@prisma/client';
import * as crypto from 'crypto';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { QueryLotDto } from '../dto/query-lot.dto';
import { BlockLotDto } from '../dto/block-lot.dto';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';
import { ConsumeStockForSaleParams, ConsumedLot } from '../types/consume-stock.types';
import { ReceiveStockParams } from '../types/receive-stock.types';
import { InsufficientStockException } from '../exceptions/insufficient-stock.exception';
import { ConcurrentStockModificationException } from '../exceptions/concurrent-stock-modification.exception';
import { LotNotActiveException } from '../exceptions/lot-not-active.exception';
import { LotNotBlockedException } from '../exceptions/lot-not-blocked.exception';
import { LotCostUnavailableException } from '../exceptions/lot-cost-unavailable.exception';

@Injectable()
export class LotsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryLotDto): Promise<any> {
    const where: Prisma.LotWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.state) where.state = query.state as LotState;
    if (query.expiresAtFrom) where.expirationDate = { gte: new Date(query.expiresAtFrom) };
    if (query.expiresAtTo) where.expirationDate = { ...where.expirationDate, lte: new Date(query.expiresAtTo) };

    const [lots, total] = await this.prisma.$transaction([
      this.prisma.lot.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { expirationDate: 'asc' },
      }),
      this.prisma.lot.count({ where }),
    ]);
    return { data: lots, total, page: query.page, pageSize: query.pageSize };
  }

  async findById(id: string): Promise<any> {
    const lot = await this.prisma.lot.findUnique({ where: { id } });
    if (!lot) throw new LotNotFoundException(id);
    return lot;
  }

  async blockLot(id: string, dto: BlockLotDto, userId: string): Promise<any> {
    const lot = await this.findById(id);
    if (lot.state !== LotState.ACTIVE) {
      throw new LotNotActiveException(id);
    }
    return this.prisma.$transaction(async (tx) => {
      const updatedLot = await tx.lot.update({
        where: { id },
        data: { state: LotState.BLOCKED, blockedAt: new Date(), blockedByUserId: userId, blockReason: dto.reason },
      });
      await this.createMovement(tx, {
        lotId: id,
        movementType: MovementType.ADMIN_BLOCK,
        quantity: 0,
        previousStock: lot.currentStock,
        resultingStock: lot.currentStock,
        createdById: userId,
        reason: dto.reason,
      });
      return updatedLot;
    });
  }

  async unblockLot(id: string, userId: string): Promise<any> {
    const lot = await this.findById(id);
    if (lot.state !== LotState.BLOCKED) {
      throw new LotNotBlockedException(id);
    }
    const newState = lot.currentStock > 0 ? LotState.ACTIVE : LotState.EXHAUSTED;
    return this.prisma.$transaction(async (tx) => {
      const updatedLot = await tx.lot.update({
        where: { id },
        data: { state: newState, blockedAt: null, blockedByUserId: null, blockReason: null },
      });
      await this.createMovement(tx, {
        lotId: id,
        movementType: MovementType.ADMIN_UNBLOCK,
        quantity: 0,
        previousStock: lot.currentStock,
        resultingStock: lot.currentStock,
        createdById: userId,
      });
      return updatedLot;
    });
  }

  async listMovements(query: QueryInventoryMovementDto): Promise<any> {
    const where: Prisma.InventoryMovementWhereInput = {};
    if (query.lotId) where.lotId = query.lotId;
    if (query.movementType) where.movementType = query.movementType as MovementType;
    if (query.createdAtFrom) where.createdAt = { gte: new Date(query.createdAtFrom) };
    if (query.createdAtTo) where.createdAt = { ...where.createdAt, lte: new Date(query.createdAtTo) };

    const [movements, total] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return { data: movements, total, page: query.page, pageSize: query.pageSize };
  }

  async consumeStockForSale(params: ConsumeStockForSaleParams): Promise<ConsumedLot[]> {
    const { productId, quantity, saleId, tx } = params;
    const availableLots = await tx.lot.findMany({
      where: { productId, state: LotState.ACTIVE, currentStock: { gt: 0 } },
      orderBy: { expirationDate: 'asc' },
      include: { purchaseReceptionItems: { select: { realUnitCost: true } } },
    });

    let totalAvailable = availableLots.reduce((sum, lot) => sum + lot.currentStock, 0);
    if (totalAvailable < quantity) {
      throw new InsufficientStockException(productId, quantity, totalAvailable);
    }

    let remainingToConsume = quantity;
    const consumedLots: ConsumedLot[] = [];

    for (const lot of availableLots) {
      if (remainingToConsume === 0) break;

      const consumeFromLot = Math.min(remainingToConsume, lot.currentStock);
      const newStock = lot.currentStock - consumeFromLot;
      const newVersion = lot.version + 1;
      const newState = newStock === 0 ? LotState.EXHAUSTED : lot.state;

      const updated = await tx.lot.updateMany({
        where: { id: lot.id, version: lot.version, productId: lot.productId },
        data: { currentStock: newStock, version: newVersion, state: newState },
      });

      if (updated.count === 0) {
        throw new ConcurrentStockModificationException(lot.id);
      }

      const unitCostAtSale = lot.purchaseReceptionItems[0]?.realUnitCost;
      if (!unitCostAtSale) {
        throw new LotCostUnavailableException(lot.id);
      }

      consumedLots.push({ lotId: lot.id, quantity: consumeFromLot, unitCostAtSale });
      await this.createMovement(tx, {
        lotId: lot.id,
        movementType: MovementType.SALE,
        quantity: consumeFromLot,
        previousStock: lot.currentStock,
        resultingStock: newStock,
        createdById: 'system',
        saleId,
      });
      remainingToConsume -= consumeFromLot;
    }
    return consumedLots;
  }

  async receiveStock(params: ReceiveStockParams): Promise<{ lotId: string }> {
    const { productId, quantity, unitCost, batchNumber, expirationDate, locationCode, purchaseReceptionId, tx } = params;
    const newLotId = crypto.randomUUID();

    // Known limitation: composite unique constraint on (productId, batchNumber) is deferred.
    // For now, every stock-receiving call creates a new Lot row.
    const newLot = await tx.lot.create({
      data: {
        id: newLotId,
        productId,
        batchNumber,
        expirationDate,
        entryDate: new Date(),
        currentStock: quantity,
        version: 0,
        state: LotState.ACTIVE,
        locationCode,
        createdById: 'system',
      },
    });

    await this.createMovement(tx, {
      lotId: newLotId,
      movementType: MovementType.PURCHASE_RECEIPT,
      quantity,
      previousStock: 0,
      resultingStock: quantity,
      createdById: 'system',
      purchaseReceptionId,
    });

    return { lotId: newLot.id };
  }

  private async createMovement(
    tx: Prisma.TransactionClient,
    data: {
      lotId: string;
      movementType: MovementType;
      quantity: number;
      previousStock: number;
      resultingStock: number;
      createdById: string;
      saleId?: string;
      purchaseReceptionId?: string;
      reason?: string;
    },
  ): Promise<any> {
    const movementData: Prisma.InventoryMovementCreateInput = {
      id: crypto.randomUUID(),
      lot: { connect: { id: data.lotId } },
      movementType: data.movementType,
      quantity: data.quantity,
      previousStock: data.previousStock,
      resultingStock: data.resultingStock,
      createdBy: { connect: { id: data.createdById } },
      reason: data.reason,
    };

    // Enforce polymorphic source: only one of these should be set
    if (data.saleId) movementData.sale = { connect: { id: data.saleId } };
    if (data.purchaseReceptionId) movementData.purchaseReception = { connect: { id: data.purchaseReceptionId } };

    return tx.inventoryMovement.create({ data: movementData });
  }

  // Methods for InventoryAdjustmentDocument and PhysicalCount remain as stubs
  async createInventoryAdjustment(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'createInventoryAdjustment');
  }

  async updateInventoryAdjustment(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'updateInventoryAdjustment');
  }

  async submitInventoryAdjustment(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'submitInventoryAdjustment');
  }

  async approveInventoryAdjustment(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'approveInventoryAdjustment');
  }

  async rejectInventoryAdjustment(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'rejectInventoryAdjustment');
  }

  async applyInventoryAdjustment(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'applyInventoryAdjustment');
  }

  async annulInventoryAdjustment(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'annulInventoryAdjustment');
  }

  async findAllInventoryAdjustments(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'findAllInventoryAdjustments');
  }

  async findInventoryAdjustmentById(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'findInventoryAdjustmentById');
  }

  async createPhysicalCount(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'createPhysicalCount');
  }

  async updatePhysicalCount(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'updatePhysicalCount');
  }

  async submitPhysicalCount(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'submitPhysicalCount');
  }

  async approvePhysicalCount(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'approvePhysicalCount');
  }

  async rejectPhysicalCount(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'rejectPhysicalCount');
  }

  async applyPhysicalCount(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'applyPhysicalCount');
  }

  async annulPhysicalCount(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'annulPhysicalCount');
  }

  async findAllPhysicalCounts(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'findAllPhysicalCounts');
  }

  async findPhysicalCountById(): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'findPhysicalCountById');
  }
}
