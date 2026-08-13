import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { Prisma, PurchaseReturnState } from '@pharmacy/database';
import * as crypto from 'crypto';
import { CreateSupplierReturnDto } from '../dto/create-supplier-return.dto';
import { QuerySupplierReturnDto } from '../dto/query-supplier-return.dto';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';
import { PurchaseReceptionNotFoundException } from '../exceptions/purchase-reception-not-found.exception';
import { SupplierReturnNotFoundException } from '../exceptions/supplier-return-not-found.exception';
import { SupplierReturnLotCostUnavailableException } from '../exceptions/supplier-return-lot-cost-unavailable.exception';
import { SupplierReturnNotDraftException } from '../exceptions/supplier-return-not-draft.exception';
import { SupplierReturnCannotBeAnnulledException } from '../exceptions/supplier-return-cannot-be-annulled.exception';
import { LotNotFoundException } from '@/modules/inventory-lots/exceptions/lot-not-found.exception';
import { SuppliersService } from './suppliers.service';
import { acquireAdvisoryLock } from '@/common/utils/advisory-lock';
import type { SupplierReturnConfirmationPayload } from '@/modules/sync/dto/purchase-sync-payloads';

@Injectable()
export class SupplierReturnsService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
    private suppliersService: SuppliersService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(query: QuerySupplierReturnDto): Promise<any> {
    const where: Prisma.SupplierReturnWhereInput = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.purchaseReceptionId) where.purchaseReceptionId = query.purchaseReceptionId;
    if (query.state) where.state = query.state as PurchaseReturnState;

    const [returns, total] = await Promise.all([
      this.prisma.supplierReturn.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { supplier: true, items: true },
      }),
      this.prisma.supplierReturn.count({ where }),
    ]);
    return { data: returns, total, page: query.page, pageSize: query.pageSize };
  }

  async findOne(id: string): Promise<any> {
    const supplierReturn = await this.prisma.supplierReturn.findUnique({
      where: { id },
      include: {
        supplier: true,
        purchaseReception: true,
        items: true,
      },
    });
    if (!supplierReturn) throw new SupplierReturnNotFoundException(id);

    // SupplierReturnItem has productId and lotId as scalars with no Prisma-level relations.
    // Fetch related entities separately.
    const itemProductIds = [...new Set(supplierReturn.items.map((i: any) => i.productId))];
    const itemLotIds = [...new Set(supplierReturn.items.map((i: any) => i.lotId))];
    const [products, lots] = await Promise.all([
      itemProductIds.length > 0
        ? this.prisma.product.findMany({ where: { id: { in: itemProductIds } } })
        : Promise.resolve([]),
      itemLotIds.length > 0
        ? this.prisma.lot.findMany({ where: { id: { in: itemLotIds } } })
        : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const lotMap = new Map(lots.map((l) => [l.id, l]));
    supplierReturn.items = supplierReturn.items.map((item: any) => ({
      ...item,
      product: productMap.get(item.productId) ?? null,
      lot: lotMap.get(item.lotId) ?? null,
    }));

    return supplierReturn;
  }

  async create(createDto: CreateSupplierReturnDto, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: createDto.supplierId } });
      if (!supplier) throw new SupplierNotFoundException(createDto.supplierId);

      if (createDto.purchaseReceptionId) {
        const reception = await tx.purchaseReception.findUnique({
          where: { id: createDto.purchaseReceptionId },
        });
        if (!reception) throw new PurchaseReceptionNotFoundException(createDto.purchaseReceptionId);
      }

      const itemsData: Array<{
        id: string; subscriptionId: string; productId: string; lotId: string; quantity: number;
        unitCost: Prisma.Decimal; totalAmount: Prisma.Decimal;
      }> = [];

      for (const item of createDto.items) {
        const lot = await tx.lot.findUnique({
          where: { id: item.lotId },
        });
        if (!lot) throw new LotNotFoundException(item.lotId);

        // PurchaseReceptionItem relation was flattened; explicit query replaces the previous Prisma include.
        const receptionItem = await tx.purchaseReceptionItem.findFirst({
          where: { lotId: lot.id },
          select: { realUnitCost: true },
        });
        const unitCost = receptionItem?.realUnitCost;
        if (!unitCost) throw new SupplierReturnLotCostUnavailableException(item.lotId);

        itemsData.push({
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
          productId: item.productId,
          lotId: item.lotId,
          quantity: item.quantity,
          unitCost: new Prisma.Decimal(unitCost),
          totalAmount: new Prisma.Decimal(item.quantity).times(unitCost),
        });
      }

      const subtotal = itemsData.reduce((sum, it) => sum.plus(it.totalAmount), new Prisma.Decimal(0));

      // Serialize sequential-number allocation per tenant so two concurrent
      // cashier creations cannot read the same MAX and produce duplicates.
      await acquireAdvisoryLock(
        tx,
        `${this.tenantContext.getSubscriptionId()}:supplier-return:seq`,
      );

      const sequentialNumber = await this.getNextSequentialNumber(tx);

      return tx.supplierReturn.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
          sequentialNumber,
          supplierId: createDto.supplierId,
          purchaseReceptionId: createDto.purchaseReceptionId || null,
          reason: createDto.reason,
          subtotal,
          totalAmount: subtotal,
          createdById: userId,
          items: { create: itemsData },
        },
        include: { items: true, supplier: true },
      });
    });
  }

  async confirm(id: string, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const supplierReturn = await tx.supplierReturn.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
      if (supplierReturn.state !== PurchaseReturnState.DRAFT) {
        throw new SupplierReturnNotDraftException(id, 'DRAFT');
      }

      for (const item of supplierReturn.items) {
        await this.lotsService.consumeStockForSupplierReturn({
          lotId: item.lotId,
          quantity: item.quantity,
          supplierReturnId: supplierReturn.id,
          tx,
        });
      }

      return tx.supplierReturn.update({
        where: { id },
        data: { state: PurchaseReturnState.CONFIRMED },
      });
    });
  }

  /**
   * Creates and confirms a supplier return from a sync payload.
   *
   * Idempotent: if a return with the same sequentialNumber + supplierId
   * already exists, the operation is skipped (ALREADY_ACCEPTED).
   * Resolves the supplier (creating inline if needed) and lots (creating
   * inline if data provided), then consumes stock as part of confirmation.
   */
  async confirmReturnFromSync(
    payload: SupplierReturnConfirmationPayload,
    userId: string,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent access to this return ID via PostgreSQL advisory
      // lock, mirroring the PO/reception sync paths. BullMQ may deliver the
      // same job to two workers concurrently — the lock ensures only one
      // reaches the idempotency check + create section, preventing a P2002
      // race on (sequentialNumber, supplierId).
      await acquireAdvisoryLock(
        tx,
        `${this.tenantContext.getSubscriptionId()}:supplier-return:${payload.returnId}`,
      );

      // Idempotency: check by POS-originated id first. If the same return
      // was already created from an earlier sync attempt, return it. The
      // (sequentialNumber, supplierId) check is a fallback for returns that
      // pre-date the POS-originated id convention.
      const existingById = await tx.supplierReturn.findUnique({
        where: { id: payload.returnId },
        select: { id: true, state: true },
      });
      if (existingById) {
        return existingById;
      }

      const existing = await tx.supplierReturn.findFirst({
        where: { sequentialNumber: payload.sequentialNumber, supplierId: payload.supplierId },
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

      if (payload.purchaseReceptionId) {
        const reception = await tx.purchaseReception.findUnique({
          where: { id: payload.purchaseReceptionId },
        });
        if (!reception) {
          throw new PurchaseReceptionNotFoundException(payload.purchaseReceptionId);
        }
      }

      const itemsData: Array<{
        id: string;
        subscriptionId: string;
        productId: string;
        lotId: string;
        quantity: number;
        unitCost: Prisma.Decimal;
        totalAmount: Prisma.Decimal;
      }> = [];

      if (payload.items && payload.items.length > 0) {
        for (const item of payload.items) {
          // Resolve lot — create inline if missing and payload carries data
          const lot = await this.lotsService.resolveLotForSync(
            tx,
            item.lotId,
            item.lot,
          );

          itemsData.push({
            id: crypto.randomUUID(),
            subscriptionId: this.tenantContext.getSubscriptionId(),
            productId: item.productId,
            lotId: item.lotId,
            quantity: item.quantity,
            unitCost: new Prisma.Decimal(item.unitCost),
            totalAmount: new Prisma.Decimal(item.quantity).times(item.unitCost),
          });
        }
      }

      const subtotal = itemsData.reduce((sum, it) => sum.plus(it.totalAmount), new Prisma.Decimal(0));

      // Compute notes — append a marker when items were missing from payload
      let notes = payload.reason ?? null;
      if (!payload.items || payload.items.length === 0) {
        const legacyMarker = '[Legacy sync: items metadata unavailable]';
        notes = notes ? `${notes} ${legacyMarker}` : legacyMarker;
      }

      // Use the POS-originated return ID so the server-side record matches
      // the ID the POS references across sync operations.
      return tx.supplierReturn.create({
        data: {
          id: payload.returnId,
          subscriptionId: this.tenantContext.getSubscriptionId(),
          sequentialNumber: payload.sequentialNumber,
          supplierId: payload.supplierId,
          purchaseReceptionId: payload.purchaseReceptionId || null,
          reason: notes,
          subtotal,
          totalAmount: subtotal,
          state: PurchaseReturnState.CONFIRMED,
          createdById: userId,
          ...(itemsData.length > 0 ? { items: { create: itemsData } } : {}),
        },
        include: { items: true, supplier: true },
      });
    });
  }

  async approve(id: string): Promise<any> {
    const supplierReturn = await this.prisma.supplierReturn.findUnique({ where: { id } });
    if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
    if (supplierReturn.state !== PurchaseReturnState.CONFIRMED) {
      throw new SupplierReturnNotDraftException(id, 'CONFIRMED');
    }

    return this.prisma.supplierReturn.update({
      where: { id },
      data: { state: PurchaseReturnState.APPROVED },
    });
  }

  async annul(id: string): Promise<any> {
    const supplierReturn = await this.prisma.supplierReturn.findUnique({ where: { id } });
    if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
    if (supplierReturn.state !== PurchaseReturnState.DRAFT) {
      throw new SupplierReturnCannotBeAnnulledException(id);
    }

    return this.prisma.supplierReturn.update({
      where: { id },
      data: { state: PurchaseReturnState.ANNULLED },
    });
  }

  private async getNextSequentialNumber(tx: Prisma.TransactionClient): Promise<number> {
    const latest = await tx.supplierReturn.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latest?.sequentialNumber || 0) + 1;
  }
}
