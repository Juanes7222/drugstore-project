import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { Prisma, PurchaseReturnState } from '@prisma/client';
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

@Injectable()
export class SupplierReturnsService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
  ) {}

  async findAll(query: QuerySupplierReturnDto): Promise<any> {
    const where: Prisma.SupplierReturnWhereInput = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.purchaseReceptionId) where.purchaseReceptionId = query.purchaseReceptionId;
    if (query.state) where.state = query.state as PurchaseReturnState;

    const [returns, total] = await this.prisma.$transaction([
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
        items: { include: { product: true, lot: true } },
      },
    });
    if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
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
        id: string; productId: string; lotId: string; quantity: number;
        unitCost: Prisma.Decimal; totalAmount: Prisma.Decimal;
      }> = [];

      for (const item of createDto.items) {
        const lot = await tx.lot.findUnique({
          where: { id: item.lotId },
          include: { purchaseReceptionItems: { select: { realUnitCost: true }, take: 1 } },
        });
        if (!lot) throw new LotNotFoundException(item.lotId);

        const unitCost = lot.purchaseReceptionItems[0]?.realUnitCost;
        if (!unitCost) throw new SupplierReturnLotCostUnavailableException(item.lotId);

        itemsData.push({
          id: crypto.randomUUID(),
          productId: item.productId,
          lotId: item.lotId,
          quantity: item.quantity,
          unitCost: new Prisma.Decimal(unitCost),
          totalAmount: new Prisma.Decimal(item.quantity).times(unitCost),
        });
      }

      const subtotal = itemsData.reduce((sum, it) => sum.plus(it.totalAmount), new Prisma.Decimal(0));
      const sequentialNumber = await this.getNextSequentialNumber(tx);

      return tx.supplierReturn.create({
        data: {
          id: crypto.randomUUID(),
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
