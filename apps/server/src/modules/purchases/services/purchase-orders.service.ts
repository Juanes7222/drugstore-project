import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, PurchaseOrderState } from '@pharmacy/database';
import * as crypto from 'crypto';
import { CreatePurchaseOrderDto, CreatePurchaseOrderItemDto } from '../dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from '../dto/query-purchase-order.dto';
import { PurchaseOrderNotDraftException } from '../exceptions/purchase-order-not-draft.exception';
import { PurchaseOrderNotFoundException } from '../exceptions/purchase-order-not-found.exception';
import { ProductNotFoundException } from '@/modules/catalog/exceptions/product-not-found.exception';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryPurchaseOrderDto): Promise<any> {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.state) where.state = query.state as PurchaseOrderState;
    if (query.createdAtFrom || query.createdAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.createdAtFrom) dateFilter.gte = new Date(query.createdAtFrom);
      if (query.createdAtTo) dateFilter.lte = new Date(query.createdAtTo);
      where.createdAt = dateFilter;
    }

    const [purchaseOrders, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { supplier: true, items: true },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { data: purchaseOrders, total, page: query.page, pageSize: query.pageSize };
  }

  async findById(id: string): Promise<any> {
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { supplier: true, items: true },
    });
    // PurchaseOrderItem has productId as a scalar with no Prisma-level relation declared.
    // Fetch product details separately if needed.
    if (purchaseOrder && purchaseOrder.items.length > 0) {
      const productIds = [...new Set(purchaseOrder.items.map((i: any) => i.productId))];
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));
      purchaseOrder.items = purchaseOrder.items.map((item: any) => ({
        ...item,
        product: productMap.get(item.productId) ?? null,
      }));
    }
    if (!purchaseOrder) {
      throw new PurchaseOrderNotFoundException(id);
    }
    return purchaseOrder;
  }

  async create(createDto: CreatePurchaseOrderDto, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: createDto.supplierId } });
      if (!supplier) {
        throw new SupplierNotFoundException(createDto.supplierId);
      }

      const itemsData = await Promise.all(createDto.items.map(async (itemDto) => {
        const product = await tx.product.findUnique({ where: { id: itemDto.productId } });
        if (!product) {
          throw new ProductNotFoundException(itemDto.productId);
        }
        return {
          id: crypto.randomUUID(),
          productId: itemDto.productId,
          requestedQuantity: itemDto.requestedQuantity,
          receivedQuantity: 0,
          pendingQuantity: itemDto.requestedQuantity, // Initial pending quantity
          expectedUnitCost: new Prisma.Decimal(itemDto.expectedUnitCost),
        };
      }));

      const subtotal = itemsData.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.requestedQuantity).times(item.expectedUnitCost)), new Prisma.Decimal(0));
      // For now, totalTax and totalAmount are same as subtotal, as tax calculation is not in scope for PO
      const totalTax = new Prisma.Decimal(0);
      const totalAmount = subtotal;

      const sequentialNumber = await this.getNextSequentialNumber(tx);

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          id: crypto.randomUUID(),
          sequentialNumber,
          state: PurchaseOrderState.DRAFT,
          supplierId: createDto.supplierId,
          expectedDeliveryDate: createDto.expectedDeliveryDate ? new Date(createDto.expectedDeliveryDate) : null,
          notes: createDto.notes,
          subtotal,
          totalTax,
          totalAmount,
          createdById: userId,
          items: { create: itemsData },
        },
      });
      return purchaseOrder;
    });
  }

  async confirm(id: string, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!purchaseOrder) {
        throw new PurchaseOrderNotFoundException(id);
      }
      if (purchaseOrder.state !== PurchaseOrderState.DRAFT) {
        throw new PurchaseOrderNotDraftException(id);
      }
      if (purchaseOrder.items.length === 0) {
        throw new Error('Purchase order must have at least one item to be confirmed.'); // Should be caught by DTO validation
      }

      const updatedPurchaseOrder = await tx.purchaseOrder.update({
        where: { id },
        data: {
          state: PurchaseOrderState.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: userId,
        },
      });
      return updatedPurchaseOrder;
    });
  }

  /**
   * Creates or confirms a purchase order from a sync payload.
   *
   * Idempotent: if a purchase order with the same sequentialNumber +
   * supplierId already exists, the operation is skipped (ALREADY_ACCEPTED).
   * Validates the supplier and all products exist before creating.
   */
  async confirmOrderFromSync(
    payload: {
      orderId: string;
      sequentialNumber: number;
      supplierId: string;
      notes?: string;
      confirmedByUserId: string;
      confirmedAt: string;
      items: Array<{ productId: string; requestedQuantity: number; expectedUnitCost: number }>;
    },
    userId: string,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency: check if PO with same sequentialNumber + supplierId exists
      const existing = await tx.purchaseOrder.findFirst({
        where: { sequentialNumber: payload.sequentialNumber, supplierId: payload.supplierId },
        select: { id: true, state: true },
      });
      if (existing) {
        return existing;
      }

      const supplier = await tx.supplier.findUnique({ where: { id: payload.supplierId } });
      if (!supplier) {
        throw new SupplierNotFoundException(payload.supplierId);
      }

      const itemsData = await Promise.all(
        payload.items.map(async (item) => {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) {
            throw new ProductNotFoundException(item.productId);
          }
          return {
            id: crypto.randomUUID(),
            productId: item.productId,
            requestedQuantity: item.requestedQuantity,
            receivedQuantity: 0,
            pendingQuantity: item.requestedQuantity,
            expectedUnitCost: new Prisma.Decimal(item.expectedUnitCost),
          };
        }),
      );

      const subtotal = itemsData.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.requestedQuantity).times(item.expectedUnitCost)),
        new Prisma.Decimal(0),
      );

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          id: crypto.randomUUID(),
          sequentialNumber: payload.sequentialNumber,
          state: PurchaseOrderState.CONFIRMED,
          supplierId: payload.supplierId,
          notes: payload.notes,
          subtotal,
          totalTax: new Prisma.Decimal(0),
          totalAmount: subtotal,
          createdById: userId,
          confirmedById: userId,
          confirmedAt: new Date(payload.confirmedAt),
          items: { create: itemsData },
        },
      });

      return purchaseOrder;
    });
  }

  async annul(id: string): Promise<any> {
    // Annulment logic is deferred
    throw new Error('Annulment not implemented for this phase.');
  }

  private async getNextSequentialNumber(tx: Prisma.TransactionClient): Promise<number> {
    const latestOrder = await tx.purchaseOrder.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latestOrder?.sequentialNumber || 0) + 1;
  }
}
