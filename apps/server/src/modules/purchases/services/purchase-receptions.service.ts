import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, PurchaseReceptionState, PurchaseOrderState, MovementType, LotState } from '@pharmacy/database';
import * as crypto from 'crypto';
import { CreatePurchaseReceptionDto, CreatePurchaseReceptionItemDto } from '../dto/create-purchase-reception.dto';
import { QueryPurchaseReceptionDto } from '../dto/query-purchase-reception.dto';
import { PurchaseReceptionNotConfirmedException } from '../exceptions/purchase-reception-not-confirmed.exception';
import { PurchaseReceptionNotDraftException } from '../exceptions/purchase-reception-not-draft.exception';
import { PurchaseReceptionNotFoundException } from '../exceptions/purchase-reception-not-found.exception';
import { OverReceptionException } from '../exceptions/over-reception.exception';
import { PurchaseOrderItemMismatchException } from '../exceptions/purchase-order-item-mismatch.exception';
import { ProductNotFoundException } from '@/modules/catalog/exceptions/product-not-found.exception';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';
import { PurchaseOrderNotFoundException } from '../exceptions/purchase-order-not-found.exception';
import { PurchaseOrderItemNotFoundException } from '../exceptions/purchase-order-item-not-found.exception';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';

@Injectable()
export class PurchaseReceptionsService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
    private fiscalDocumentsService: FiscalDocumentsService,
  ) {}

  async findAll(query: QueryPurchaseReceptionDto): Promise<any> {
    const where: Prisma.PurchaseReceptionWhereInput = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.state) where.state = query.state as PurchaseReceptionState;
    if (query.receivedAtFrom || query.receivedAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.receivedAtFrom) dateFilter.gte = new Date(query.receivedAtFrom);
      if (query.receivedAtTo) dateFilter.lte = new Date(query.receivedAtTo);
      where.receivedAt = dateFilter;
    }

    const [receptions, total] = await this.prisma.$transaction([
      this.prisma.purchaseReception.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { supplier: true, purchaseOrder: true, items: true },
      }),
      this.prisma.purchaseReception.count({ where }),
    ]);
    return { data: receptions, total, page: query.page, pageSize: query.pageSize };
  }

  async findById(id: string): Promise<any> {
    const reception = await this.prisma.purchaseReception.findUnique({
      where: { id },
      include: { supplier: true, purchaseOrder: true, items: { include: { product: true, purchaseOrderItem: true } } },
    });
    if (!reception) {
      throw new PurchaseReceptionNotFoundException(id);
    }
    return reception;
  }

  async create(createDto: CreatePurchaseReceptionDto, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: createDto.supplierId } });
      if (!supplier) {
        throw new SupplierNotFoundException(createDto.supplierId);
      }

      let purchaseOrder = null;
      if (createDto.purchaseOrderId) {
        purchaseOrder = await tx.purchaseOrder.findUnique({
          where: { id: createDto.purchaseOrderId },
          include: { items: true },
        });
        if (!purchaseOrder) {
          throw new PurchaseOrderNotFoundException(createDto.purchaseOrderId);
        }
      }

      const itemsData = await Promise.all(createDto.items.map(async (itemDto) => {
        const product = await tx.product.findUnique({ where: { id: itemDto.productId } });
        if (!product) {
          throw new ProductNotFoundException(itemDto.productId);
        }

        let purchaseOrderItem = null;
        if (itemDto.purchaseOrderItemId) {
          purchaseOrderItem = await tx.purchaseOrderItem.findUnique({
            where: { id: itemDto.purchaseOrderItemId },
          });
          if (!purchaseOrderItem) {
            throw new PurchaseOrderItemNotFoundException(itemDto.purchaseOrderItemId);
          }
          if (purchaseOrderItem.purchaseOrderId !== createDto.purchaseOrderId) {
            throw new PurchaseOrderItemMismatchException(itemDto.purchaseOrderItemId, 'Does not belong to the specified purchase order.');
          }
          if (purchaseOrderItem.productId !== itemDto.productId) {
            throw new PurchaseOrderItemMismatchException(itemDto.purchaseOrderItemId, 'Product ID mismatch.');
          }
          if (itemDto.receivedQuantity > (purchaseOrderItem.requestedQuantity - purchaseOrderItem.receivedQuantity)) {
            throw new OverReceptionException(itemDto.purchaseOrderItemId, purchaseOrderItem.requestedQuantity - purchaseOrderItem.receivedQuantity, itemDto.receivedQuantity);
          }
        }

        return {
          id: crypto.randomUUID(),
          productId: itemDto.productId,
          purchaseOrderItemId: itemDto.purchaseOrderItemId || null,
          receivedQuantity: itemDto.receivedQuantity,
          lotNumber: itemDto.lotNumber || null,
          expirationDate: itemDto.expirationDate ? new Date(itemDto.expirationDate) : null,
          realUnitCost: new Prisma.Decimal(itemDto.realUnitCost),
          taxSchemeId: itemDto.taxSchemeId,
          taxRate: new Prisma.Decimal(itemDto.taxRate),
          discountAmount: new Prisma.Decimal(itemDto.discountAmount || 0),
        };
      }));

      const { subtotal, totalTax, totalAmount } = this.calculateReceptionTotals(itemsData);
      const sequentialNumber = await this.getNextSequentialNumber(tx);

      const reception = await tx.purchaseReception.create({
        data: {
          id: crypto.randomUUID(),
          sequentialNumber,
          state: PurchaseReceptionState.DRAFT,
          supplierId: createDto.supplierId,
          purchaseOrderId: createDto.purchaseOrderId || null,
          notes: createDto.notes,
          subtotal,
          totalTax,
          totalAmount,
          createdById: userId,
          items: { create: itemsData },
        },
      });
      return reception;
    });
  }

  async confirm(id: string, userId: string, workstationId: string): Promise<any> {
    let fiscalDocumentId: string | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      const reception = await tx.purchaseReception.findUnique({
        where: { id },
        include: { items: { include: { purchaseOrderItem: true } }, purchaseOrder: { include: { items: true } } },
      });

      if (!reception) {
        throw new PurchaseReceptionNotFoundException(id);
      }
      if (reception.state !== PurchaseReceptionState.DRAFT) {
        throw new PurchaseReceptionNotDraftException(id);
      }

      for (const item of reception.items) {
        if (!item.expirationDate) {
          throw new Error(`Item ${item.id} is missing expiration date`);
        }
        const lot = await this.lotsService.receiveStock({
          productId: item.productId,
          quantity: item.receivedQuantity,
          unitCost: item.realUnitCost as unknown as Prisma.Decimal,
          batchNumber: item.lotNumber || 'UNKNOWN',
          expirationDate: item.expirationDate,
          locationCode: undefined,
          purchaseReceptionId: reception.id,
          tx,
        });

        await tx.purchaseReceptionItem.update({
          where: { id: item.id },
          data: { lotId: lot.lotId },
        });

        if (item.purchaseOrderItemId) {
          const updatedOrderItem = await tx.purchaseOrderItem.update({
            where: { id: item.purchaseOrderItemId },
            data: {
              receivedQuantity: { increment: item.receivedQuantity },
              pendingQuantity: { decrement: item.receivedQuantity },
            },
          });

          // Update parent PurchaseOrder state
          const purchaseOrder = reception.purchaseOrder;
          if (purchaseOrder) {
            const allItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: purchaseOrder.id } });
            const hasPendingItems = allItems.some(poItem => poItem.pendingQuantity > 0);
            const newOrderState = hasPendingItems ? PurchaseOrderState.PARTIALLY_RECEIVED : PurchaseOrderState.FULLY_RECEIVED;

            if (purchaseOrder.state !== newOrderState) {
              await tx.purchaseOrder.update({
                where: { id: purchaseOrder.id },
                data: { state: newOrderState },
              });
            }
          }
        }
      }

      const updatedReception = await tx.purchaseReception.update({
        where: { id },
        data: {
          state: PurchaseReceptionState.CONFIRMED,
          receivedAt: new Date(),
        },
      });

      // Fiscal document created inside the same transaction — if it fails,
      // the whole reception confirmation rolls back.
      const fiscalDoc =
        await this.fiscalDocumentsService.createPendingDocumentForPurchaseReception({
          purchaseReceptionId: id,
          workstationId,
          tx,
        });
      if (fiscalDoc) {
        fiscalDocumentId = fiscalDoc.id;
      }

      return updatedReception;
    });

    // Enqueue only after the transaction has committed successfully,
    // and only when a document was actually created (NIT supplier returns null).
    if (fiscalDocumentId) {
      await this.fiscalDocumentsService.enqueueGenerationJob(fiscalDocumentId);
    }

    return result;
  }

  async annul(id: string, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const reception = await tx.purchaseReception.findUnique({
        where: { id },
        include: {
          items: { include: { purchaseOrderItem: true } },
          purchaseOrder: { include: { items: true } },
        },
      });

      if (!reception) {
        throw new PurchaseReceptionNotFoundException(id);
      }
      if (reception.state !== PurchaseReceptionState.CONFIRMED) {
        throw new PurchaseReceptionNotConfirmedException(id);
      }

      // Reverse stock for each reception item
      for (const item of reception.items) {
        if (!item.lotId) continue;

        const lot = await tx.lot.findUnique({ where: { id: item.lotId } });
        if (!lot) continue;

        const newStock = lot.currentStock - item.receivedQuantity;
        const newState = newStock <= 0 ? LotState.EXHAUSTED : lot.state;

        const updated = await tx.lot.updateMany({
          where: { id: item.lotId, version: lot.version },
          data: {
            currentStock: newStock < 0 ? 0 : newStock,
            version: { increment: 1 },
            state: newState,
          },
        });
        if (updated.count === 0) {
          throw new Error(`Concurrent stock modification on lot ${item.lotId} during reception annulment`);
        }

        // Record reversal movement
        await tx.inventoryMovement.create({
          data: {
            id: crypto.randomUUID(),
            lotId: item.lotId,
            movementType: MovementType.NEGATIVE_ADJUSTMENT,
            quantity: item.receivedQuantity,
            previousStock: lot.currentStock,
            resultingStock: newStock < 0 ? 0 : newStock,
            createdById: userId,
            createdAt: new Date(),
            reason: `Reversal of purchase reception ${id}`,
            purchaseReceptionId: reception.id,
          },
        });

        // Revert purchase order item received/pending quantities
        if (item.purchaseOrderItemId) {
          await tx.purchaseOrderItem.update({
            where: { id: item.purchaseOrderItemId },
            data: {
              receivedQuantity: { decrement: item.receivedQuantity },
              pendingQuantity: { increment: item.receivedQuantity },
            },
          });
        }
      }

      // Revert purchase order state if linked
      if (reception.purchaseOrder) {
        const allItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: reception.purchaseOrder.id },
        });
        const hasAnyReceived = allItems.some(poItem => poItem.receivedQuantity > 0);
        const newOrderState = hasAnyReceived ? PurchaseOrderState.PARTIALLY_RECEIVED : PurchaseOrderState.CONFIRMED;
        if (reception.purchaseOrder.state !== newOrderState) {
          await tx.purchaseOrder.update({
            where: { id: reception.purchaseOrder.id },
            data: { state: newOrderState },
          });
        }
      }

      // Annul associated fiscal document if one exists
      const fiscalDoc = await tx.fiscalDocument.findFirst({
        where: { purchaseReceptionId: id, fiscalState: { notIn: ['ANNULLED'] } },
        select: { id: true },
      });
      if (fiscalDoc) {
        await tx.fiscalDocument.update({
          where: { id: fiscalDoc.id },
          data: { fiscalState: 'ANNULLED' },
        });
      }

      return tx.purchaseReception.update({
        where: { id },
        data: { state: PurchaseReceptionState.ANNULLED },
      });
    });
  }

  private calculateReceptionTotals(
    items: Array<{ receivedQuantity: number; realUnitCost: Prisma.Decimal; discountAmount: Prisma.Decimal; taxRate: Prisma.Decimal }>,
  ): {
    subtotal: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const subtotal = items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.receivedQuantity).times(item.realUnitCost).minus(item.discountAmount)),
      new Prisma.Decimal(0),
    );
    const totalTax = items.reduce((sum, item) => {
      const itemSubtotal = new Prisma.Decimal(item.receivedQuantity).times(item.realUnitCost).minus(item.discountAmount);
      return sum.plus(itemSubtotal.times(item.taxRate).dividedBy(100));
    }, new Prisma.Decimal(0));
    const totalAmount = subtotal.plus(totalTax);
    return { subtotal, totalTax, totalAmount };
  }

  private async getNextSequentialNumber(tx: Prisma.TransactionClient): Promise<number> {
    const latestReception = await tx.purchaseReception.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latestReception?.sequentialNumber || 0) + 1;
  }
}
