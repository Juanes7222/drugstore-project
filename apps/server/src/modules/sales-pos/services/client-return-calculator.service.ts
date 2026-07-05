import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, ClientReturnState } from '@prisma/client';
import { CreateClientReturnItemDto } from '../dto/create-client-return.dto';
import { SaleItemNotFoundException } from '../exceptions/sale-item-not-found.exception';
import { ReturnQuantityExceedsAvailableException } from '../exceptions/return-quantity-exceeds-available.exception';

export interface ReturnItemPrep {
  saleItemId: string;
  quantity: number;
  unitPriceAtSale: Prisma.Decimal;
  unitPriceAtReturn: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  lots: Array<{ lotId: string; quantity: number }>;
}

interface SaleItemWithRelations {
  id: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  product: {
    currentPrice: { price: Prisma.Decimal } | null;
    currentTaxHistory: { taxScheme: { rate: Prisma.Decimal } } | null;
  } | null;
  lots: Array<{ lotId: string; quantity: number }>;
}

@Injectable()
export class ClientReturnCalculatorService {
  constructor(private prisma: PrismaService) {}

  async prepareReturnItem(tx: Prisma.TransactionClient, saleId: string, item: CreateClientReturnItemDto): Promise<ReturnItemPrep> {
    const saleItem = await this.fetchSaleItem(tx, item.saleItemId);
    await this.validateAvailableQuantity(tx, item);
    const prices = this.computePrices(saleItem, item.quantity);
    const lotAssignments = this.resolveLotAssignments(item.lots, saleItem.lots, item.quantity);
    return { ...prices, saleItemId: saleItem.id, lots: lotAssignments };
  }

  private async fetchSaleItem(tx: Prisma.TransactionClient, saleItemId: string): Promise<SaleItemWithRelations> {
    const saleItem = await tx.saleItem.findUnique({
      where: { id: saleItemId },
      include: {
        product: {
          include: { currentPrice: true, currentTaxHistory: { include: { taxScheme: true } } },
        },
        lots: true,
      },
    });
    if (!saleItem) throw new SaleItemNotFoundException(saleItemId);
    return saleItem as unknown as SaleItemWithRelations;
  }

  private async validateAvailableQuantity(tx: Prisma.TransactionClient, item: CreateClientReturnItemDto): Promise<void> {
    const alreadyReturned = await this.getAlreadyReturnedQuantity(tx, item.saleItemId);
    const saleItem = await tx.saleItem.findUnique({ where: { id: item.saleItemId } });
    const available = (saleItem?.quantity || 0) - alreadyReturned;
    if (item.quantity > available) {
      throw new ReturnQuantityExceedsAvailableException(item.saleItemId, item.quantity, available);
    }
  }

  private computePrices(saleItem: SaleItemWithRelations, quantity: number): {
    quantity: number;
    unitPriceAtSale: Prisma.Decimal;
    unitPriceAtReturn: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const unitPriceAtSale = saleItem.unitPrice;
    const unitPriceAtReturn = saleItem.product?.currentPrice?.price || new Prisma.Decimal(0);
    const taxRate = saleItem.product?.currentTaxHistory?.taxScheme?.rate || new Prisma.Decimal(0);
    const decQty = new Prisma.Decimal(quantity);
    const grossAmount = unitPriceAtReturn.times(decQty);
    const taxAmount = grossAmount.times(taxRate.dividedBy(100));
    const totalAmount = grossAmount.plus(taxAmount);
    return { quantity, unitPriceAtSale, unitPriceAtReturn, taxAmount, totalAmount };
  }

  private resolveLotAssignments(
    explicitLots: Array<{ lotId: string; quantity: number }> | undefined,
    saleItemLots: Array<{ lotId: string; quantity: number }>,
    returnQuantity: number,
  ): Array<{ lotId: string; quantity: number }> {
    if (explicitLots && explicitLots.length > 0) return explicitLots;
    const assignments: Array<{ lotId: string; quantity: number }> = [];
    let remaining = returnQuantity;
    for (const sil of saleItemLots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, sil.quantity);
      assignments.push({ lotId: sil.lotId, quantity: take });
      remaining -= take;
    }
    return assignments;
  }

  async getAlreadyReturnedQuantity(tx: Prisma.TransactionClient, saleItemId: string): Promise<number> {
    const result = await tx.clientReturnItem.aggregate({
      where: { saleItemId, clientReturn: { state: ClientReturnState.CONFIRMED } },
      _sum: { quantity: true },
    });
    return result._sum.quantity || 0;
  }

  async getDefaultRefundMethod(tx: Prisma.TransactionClient, saleId: string): Promise<string> {
    const firstPayment = await tx.salePayment.findFirst({
      where: { saleId }, orderBy: { createdAt: 'asc' }, select: { paymentMethodId: true },
    });
    return firstPayment!.paymentMethodId;
  }

  async getNextSequentialNumber(tx: Prisma.TransactionClient): Promise<number> {
    const latest = await tx.clientReturn.findFirst({
      orderBy: { sequentialNumber: 'desc' }, select: { sequentialNumber: true },
    });
    return (latest?.sequentialNumber || 0) + 1;
  }
}
