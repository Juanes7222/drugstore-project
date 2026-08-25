import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import {
  Prisma,
  PurchaseReceptionState,
  PurchaseOrderState,
  MovementType,
  LotState,
} from '@pharmacy/database';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';
import * as crypto from 'crypto';
import {
  CreatePurchaseReceptionDto,
  CreatePurchaseReceptionItemDto,
} from '../dto/create-purchase-reception.dto';
import { QueryPurchaseReceptionDto } from '../dto/query-purchase-reception.dto';
import { PurchaseReceptionNotConfirmedException } from '../exceptions/purchase-reception-not-confirmed.exception';
import { PurchaseReceptionNotDraftException } from '../exceptions/purchase-reception-not-draft.exception';
import { PurchaseReceptionNotFoundException } from '../exceptions/purchase-reception-not-found.exception';
import { MissingExpirationDateException } from '../exceptions/missing-expiration-date.exception';
import { OverReceptionException } from '../exceptions/over-reception.exception';
import { PurchaseOrderItemMismatchException } from '../exceptions/purchase-order-item-mismatch.exception';
import { ProductNotFoundException } from '@/modules/catalog/exceptions/product-not-found.exception';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';
import { PurchaseOrderNotFoundException } from '../exceptions/purchase-order-not-found.exception';
import { PurchaseOrderItemNotFoundException } from '../exceptions/purchase-order-item-not-found.exception';
import { SuppliersService } from './suppliers.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';
import { toDecimal } from '@/common/to-decimal';
import { acquireAdvisoryLock } from '@/common/utils/advisory-lock';
import type { PurchaseReceptionConfirmationPayload } from '@/modules/sync/dto/purchase-sync-payloads';

@Injectable()
export class PurchaseReceptionsService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
    private fiscalDocumentsService: FiscalDocumentsService,
    private suppliersService: SuppliersService,
    private readonly tenantContext: TenantContextService,
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

    const listInclude = {
      supplier: true,
      purchaseOrder: true,
      items: true,
    } satisfies Prisma.PurchaseReceptionInclude;

    if (query.cursor) {
      const page = await paginateWithCursor<
        unknown,
        Prisma.PurchaseReceptionWhereInput,
        Prisma.PurchaseReceptionOrderByWithRelationInput,
        Prisma.PurchaseReceptionInclude
      >({
        model: this.prisma.purchaseReception,
        baseWhere: where,
        limit: query.pageSize,
        cursor: query.cursor,
        timeField: 'createdAt',
        direction: 'desc',
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: listInclude,
      });
      return {
        data: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        pageSize: query.pageSize,
      };
    }

    const [receptions, total] = await Promise.all([
      this.prisma.purchaseReception.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: listInclude,
      }),
      this.prisma.purchaseReception.count({ where }),
    ]);
    return {
      data: receptions,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findById(id: string): Promise<any> {
    const reception = await this.prisma.purchaseReception.findUnique({
      where: { id },
      include: {
        supplier: true,
        purchaseOrder: true,
        items: { include: { product: true, purchaseOrderItem: true } },
      },
    });
    if (!reception) {
      throw new PurchaseReceptionNotFoundException(id);
    }
    return reception;
  }

  async create(
    createDto: CreatePurchaseReceptionDto,
    userId: string,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: createDto.supplierId },
      });
      if (!supplier) {
        throw new SupplierNotFoundException(createDto.supplierId);
      }

      let purchaseOrder: Prisma.PurchaseOrderGetPayload<{
        include: { items: true };
      }> | null;
      if (createDto.purchaseOrderId) {
        purchaseOrder = await tx.purchaseOrder.findUnique({
          where: { id: createDto.purchaseOrderId },
          include: { items: true },
        });
        if (!purchaseOrder) {
          throw new PurchaseOrderNotFoundException(createDto.purchaseOrderId);
        }
      }

      const itemsData = await Promise.all(
        createDto.items.map(async (itemDto) => {
          const product = await tx.product.findUnique({
            where: { id: itemDto.productId },
          });
          if (!product) {
            throw new ProductNotFoundException(itemDto.productId);
          }

          let purchaseOrderItem: Awaited<
            ReturnType<typeof tx.purchaseOrderItem.findUnique>
          >;
          if (itemDto.purchaseOrderItemId) {
            purchaseOrderItem = await tx.purchaseOrderItem.findUnique({
              where: { id: itemDto.purchaseOrderItemId },
            });
            if (!purchaseOrderItem) {
              throw new PurchaseOrderItemNotFoundException(
                itemDto.purchaseOrderItemId,
              );
            }
            if (
              purchaseOrderItem.purchaseOrderId !== createDto.purchaseOrderId
            ) {
              throw new PurchaseOrderItemMismatchException(
                itemDto.purchaseOrderItemId,
                'Does not belong to the specified purchase order.',
              );
            }
            if (purchaseOrderItem.productId !== itemDto.productId) {
              throw new PurchaseOrderItemMismatchException(
                itemDto.purchaseOrderItemId,
                'Product ID mismatch.',
              );
            }
            if (
              itemDto.receivedQuantity >
              purchaseOrderItem.requestedQuantity -
                purchaseOrderItem.receivedQuantity
            ) {
              throw new OverReceptionException(
                itemDto.purchaseOrderItemId,
                purchaseOrderItem.requestedQuantity -
                  purchaseOrderItem.receivedQuantity,
                itemDto.receivedQuantity,
              );
            }
          }

          return {
            id: crypto.randomUUID(),
            subscriptionId: this.tenantContext.getSubscriptionId(),
            productId: itemDto.productId,
            purchaseOrderItemId: itemDto.purchaseOrderItemId || null,
            receivedQuantity: itemDto.receivedQuantity,
            lotNumber: itemDto.lotNumber || null,
            expirationDate: itemDto.expirationDate
              ? new Date(itemDto.expirationDate)
              : null,
            realUnitCost: new Prisma.Decimal(itemDto.realUnitCost),
            taxSchemeId: itemDto.taxSchemeId,
            taxRate: new Prisma.Decimal(itemDto.taxRate),
            discountAmount: new Prisma.Decimal(itemDto.discountAmount || 0),
          };
        }),
      );

      const { subtotal, totalTax, totalAmount } =
        this.calculateReceptionTotals(itemsData);

      // Serialize sequential-number allocation per tenant so two concurrent
      // cashier creations cannot read the same MAX and produce duplicates.
      await acquireAdvisoryLock(
        tx,
        `${this.tenantContext.getSubscriptionId()}:purchase-reception:seq`,
      );

      const sequentialNumber = await this.getNextSequentialNumber(tx);

      const reception = await tx.purchaseReception.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
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

  async confirm(
    id: string,
    userId: string,
    workstationId: string,
  ): Promise<any> {
    let fiscalDocumentId: string | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
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
      if (reception.state !== PurchaseReceptionState.DRAFT) {
        throw new PurchaseReceptionNotDraftException(id);
      }

      // Track received increments in memory so the PO state can be derived
      // after the loop without re-fetching its items per reception item
      // (the previous per-item findMany made confirm O(n²)).
      const receivedByOrderItemId = new Map<string, number>();

      for (const item of reception.items) {
        if (!item.expirationDate) {
          throw new MissingExpirationDateException(item.id);
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
          receivedByOrderItemId.set(
            item.purchaseOrderItemId,
            updatedOrderItem.receivedQuantity,
          );
        }
      }

      // Update parent PurchaseOrder state once, from the items already loaded
      // in the include above plus the increments applied during this loop.
      const purchaseOrder = reception.purchaseOrder;
      if (purchaseOrder) {
        const hasPendingItems = purchaseOrder.items.some((poItem) => {
          const receivedNow =
            receivedByOrderItemId.get(poItem.id) ?? poItem.receivedQuantity;
          return poItem.requestedQuantity - receivedNow > 0;
        });
        const newOrderState = hasPendingItems
          ? PurchaseOrderState.PARTIALLY_RECEIVED
          : PurchaseOrderState.FULLY_RECEIVED;

        if (purchaseOrder.state !== newOrderState) {
          await tx.purchaseOrder.update({
            where: { id: purchaseOrder.id },
            data: { state: newOrderState },
          });
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
        await this.fiscalDocumentsService.createPendingDocumentForPurchaseReception(
          {
            purchaseReceptionId: id,
            workstationId,
            tx,
          },
        );
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

  /**
   * Creates and confirms a purchase reception from a sync payload.
   *
   * Idempotent: if a reception with the same sequentialNumber + supplierId
   * already exists, the operation is skipped (ALREADY_ACCEPTED).
   * Resolves the supplier (creating inline if needed), validates products,
   * creates Lot records with inventory movements, and links them to
   * reception items.
   */
  async confirmReceptionFromSync(
    payload: PurchaseReceptionConfirmationPayload,
    userId: string,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent access to this reception ID via PostgreSQL
      // advisory lock. BullMQ may deliver the same job to two workers
      // concurrently — the lock ensures only one reaches the idempotency
      // check + create section, preventing a P2002 race.
      await acquireAdvisoryLock(
        tx,
        `${this.tenantContext.getSubscriptionId()}:purchase-reception:${payload.receptionId}`,
      );

      // Idempotency: check by POS-originated id first. If the same reception
      // was already created from an earlier sync attempt, return it. The
      // (sequentialNumber, supplierId) check is a fallback for receptions
      // that pre-date the POS-originated id convention.
      const existingById = await tx.purchaseReception.findUnique({
        where: { id: payload.receptionId },
        select: { id: true, state: true },
      });
      if (existingById) {
        return existingById;
      }

      const existing = await tx.purchaseReception.findFirst({
        where: {
          sequentialNumber: payload.sequentialNumber,
          supplierId: payload.supplierId,
        },
        select: { id: true, state: true },
      });
      if (existing) {
        return existing;
      }

      // Resolve supplier — create inline if missing and payload carries data
      await this.suppliersService.resolveSupplierForSync(
        tx,
        payload.supplierId,
        payload.supplier,
        userId,
      );

      let purchaseOrder: Prisma.PurchaseOrderGetPayload<{
        include: { items: true };
      }> | null;
      if (payload.purchaseOrderId) {
        purchaseOrder = await tx.purchaseOrder.findUnique({
          where: { id: payload.purchaseOrderId },
          include: { items: true },
        });

        // Offline-first: the PO confirmation sync may not have arrived yet.
        // Create a minimal PO stub so the reception can proceed. The real PO
        // confirmation operation (when it arrives) will skip via idempotency.
        if (!purchaseOrder) {
          const nextSeq = await tx.purchaseOrder.aggregate({
            _max: { sequentialNumber: true },
          });
          const stubSeq = (nextSeq._max.sequentialNumber ?? 0) + 1;
          await tx.purchaseOrder.create({
            data: {
              id: payload.purchaseOrderId,
              subscriptionId: this.tenantContext.getSubscriptionId(),
              sequentialNumber: stubSeq,
              state: PurchaseOrderState.CONFIRMED,
              supplierId: payload.supplierId,
              subtotal: new Prisma.Decimal(0),
              totalTax: new Prisma.Decimal(0),
              totalAmount: new Prisma.Decimal(0),
              createdById: userId,
              confirmedById: userId,
              confirmedAt: new Date(payload.confirmedAt),
              notes: 'Auto-created by reception sync — PO confirmation pending',
            },
            include: { items: true },
          });
        }
      }

      // Resolve a default tax scheme for reception items.
      const defaultTaxScheme = await tx.taxScheme.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, rate: true },
      });
      const taxSchemeId =
        defaultTaxScheme?.id ?? '00000000-0000-0000-0000-000000000000';
      const taxRate = defaultTaxScheme?.rate ?? new Prisma.Decimal(0);

      // Use the POS-originated reception ID so downstream sync operations
      // (returns) can reference this reception by the same ID.
      const receptionId = payload.receptionId;
      const itemsData: Array<{
        id: string;
        productId: string;
        receivedQuantity: number;
        lotNumber: string | null;
        expirationDate: Date | null;
        realUnitCost: Prisma.Decimal;
        taxSchemeId: string;
        taxRate: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
        lotId: string | null;
      }> = [];

      if (payload.items && payload.items.length > 0) {
        for (const item of payload.items) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });
          if (!product) {
            throw new ProductNotFoundException(item.productId);
          }

          // Create/resolve Lot record when the payload carries a lotId.
          // The POS knows on which lot each received unit lands; the server
          // mirrors that so subsequent sync ops (inventory adjustments,
          // supplier returns) can reference the lot.
          let resolvedLotId: string | null = null;
          if (item.lotId) {
            const resolved = await this.lotsService.resolveLotForSync(
              tx,
              item.lotId,
              item.lot ?? {
                batchNumber: item.batchNumber ?? 'UNKNOWN',
                expirationDate: item.expirationDate ?? new Date().toISOString(),
                productId: item.productId,
                currentStock: item.quantity,
              },
            );
            resolvedLotId = resolved.id;

            // Record an inventory movement for the receipt
            await tx.inventoryMovement.create({
              data: {
                id: crypto.randomUUID(),
                subscriptionId: this.tenantContext.getSubscriptionId(),
                lotId: resolvedLotId,
                movementType: MovementType.PURCHASE_RECEIPT,
                quantity: item.quantity,
                previousStock: resolved.currentStock - item.quantity,
                resultingStock: resolved.currentStock,
                createdById: 'system',
                createdAt: new Date(payload.confirmedAt),
                purchaseReceptionId: receptionId,
              },
            });
          }

          itemsData.push({
            id: crypto.randomUUID(),
            productId: item.productId,
            receivedQuantity: item.quantity,
            lotNumber: item.batchNumber || null,
            expirationDate: item.expirationDate
              ? new Date(item.expirationDate)
              : null,
            // Zod-validated at the dispatcher, but cast through toDecimal so a
            // missing/non-numeric value surfaces a clear `SYNC_PAYLOAD_VALIDATION`
            // error pointing at `items[N].unitCost` instead of a raw
            // `[DecimalError] Invalid argument: undefined` from decimal.js.
            realUnitCost: toDecimal(item.unitCost, {
              fieldName: `items[${itemsData.length}].unitCost`,
            }),
            taxSchemeId,
            taxRate,
            discountAmount: new Prisma.Decimal(0),
            lotId: resolvedLotId,
          });
        }
      }

      const subtotal =
        itemsData.length > 0
          ? itemsData.reduce(
              (sum, item) =>
                sum.plus(
                  new Prisma.Decimal(item.receivedQuantity).times(
                    item.realUnitCost,
                  ),
                ),
              new Prisma.Decimal(0),
            )
          : new Prisma.Decimal(0);

      // Compute notes — append a marker when items were missing from payload
      let notes = payload.notes ?? null;
      if (!payload.items || payload.items.length === 0) {
        const legacyMarker = '[Legacy sync: items metadata unavailable]';
        notes = notes ? `${notes} ${legacyMarker}` : legacyMarker;
      }

      const reception = await tx.purchaseReception.create({
        data: {
          id: receptionId,
          subscriptionId: this.tenantContext.getSubscriptionId(),
          sequentialNumber: payload.sequentialNumber,
          state: PurchaseReceptionState.CONFIRMED,
          supplierId: payload.supplierId,
          purchaseOrderId: payload.purchaseOrderId || null,
          notes,
          subtotal,
          totalTax: new Prisma.Decimal(0),
          totalAmount: subtotal,
          createdById: userId,
          receivedAt: new Date(payload.confirmedAt),
          ...(itemsData.length > 0
            ? {
                items: {
                  create: itemsData.map((item) => ({
                    id: item.id,
                    subscriptionId: this.tenantContext.getSubscriptionId(),
                    productId: item.productId,
                    receivedQuantity: item.receivedQuantity,
                    lotNumber: item.lotNumber,
                    expirationDate: item.expirationDate,
                    realUnitCost: item.realUnitCost,
                    taxSchemeId: item.taxSchemeId,
                    taxRate: item.taxRate,
                    discountAmount: item.discountAmount,
                    ...(item.lotId ? { lotId: item.lotId } : {}),
                  })),
                },
              }
            : {}),
        },
      });

      return reception;
    });
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
          throw new Error(
            `Concurrent stock modification on lot ${item.lotId} during reception annulment`,
          );
        }

        // Record reversal movement
        await tx.inventoryMovement.create({
          data: {
            id: crypto.randomUUID(),
            subscriptionId: this.tenantContext.getSubscriptionId(),
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
        const hasAnyReceived = allItems.some(
          (poItem) => poItem.receivedQuantity > 0,
        );
        const newOrderState = hasAnyReceived
          ? PurchaseOrderState.PARTIALLY_RECEIVED
          : PurchaseOrderState.CONFIRMED;
        if (reception.purchaseOrder.state !== newOrderState) {
          await tx.purchaseOrder.update({
            where: { id: reception.purchaseOrder.id },
            data: { state: newOrderState },
          });
        }
      }

      // Annul associated fiscal document if one exists
      const fiscalDoc = await tx.fiscalDocument.findFirst({
        where: {
          purchaseReceptionId: id,
          fiscalState: { notIn: ['ANNULLED'] },
        },
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
    items: Array<{
      receivedQuantity: number;
      realUnitCost: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      taxRate: Prisma.Decimal;
    }>,
  ): {
    subtotal: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const subtotal = items.reduce(
      (sum, item) =>
        sum.plus(
          new Prisma.Decimal(item.receivedQuantity)
            .times(item.realUnitCost)
            .minus(item.discountAmount),
        ),
      new Prisma.Decimal(0),
    );
    const totalTax = items.reduce((sum, item) => {
      const itemSubtotal = new Prisma.Decimal(item.receivedQuantity)
        .times(item.realUnitCost)
        .minus(item.discountAmount);
      return sum.plus(itemSubtotal.times(item.taxRate).dividedBy(100));
    }, new Prisma.Decimal(0));
    const totalAmount = subtotal.plus(totalTax);
    return { subtotal, totalTax, totalAmount };
  }

  private async getNextSequentialNumber(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const latestReception = await tx.purchaseReception.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latestReception?.sequentialNumber || 0) + 1;
  }
}
