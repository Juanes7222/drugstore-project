import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, SaleOperationalState, SaleType, ShiftState, IdentificationType, ClientType, AuditAction, SystemModule } from '@pharmacy/database';
import * as crypto from 'crypto';
import { CreateSaleDto, CreateSaleItemDto } from '../dto/create-sale.dto';
import { QuerySaleDto } from '../dto/query-sale.dto';
import { ConfirmSaleDto, PaymentInputSchema } from '../dto/confirm-sale.dto';
import { z } from 'zod';
import { SaleNotFoundException } from '../exceptions/sale-not-found.exception';
import { CashShiftNotOpenForWorkstationException } from '../exceptions/cash-shift-not-open-for-workstation.exception';
import { PrescriptionRequiredNotSupportedException } from '../exceptions/prescription-required-not-supported.exception';
import { PaymentAmountMismatchException } from '../exceptions/payment-amount-mismatch.exception';
import { ChangeRequiresCashPaymentException } from '../exceptions/change-requires-cash-payment.exception';
import { SaleNotInProgressException } from '../exceptions/sale-not-in-progress.exception';
import { SaleNotConfirmedException } from '../exceptions/sale-not-confirmed.exception';
import { AnnulSaleDto } from '../dto/annul-sale.dto';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { ConsumedLot } from '@/modules/inventory-lots/types/consume-stock.types';
import { LotNotFoundException } from '@/modules/inventory-lots/exceptions/lot-not-found.exception';
import { ProductNotFoundException } from '@/modules/catalog/exceptions/product-not-found.exception';
import { DiscountReasonRequiredException } from '@/modules/catalog/exceptions/discount-reason-required.exception';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';

interface SaleItemCalculations {
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountPercentage: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

type SaleItemTotals = { subtotal: Prisma.Decimal; discountAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; total: Prisma.Decimal };

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
    private fiscalDocumentsService: FiscalDocumentsService,
  ) {}

  async findAll(query: QuerySaleDto): Promise<any> {
    const where: Prisma.SaleWhereInput = {};
    if (query.clientId) where.clientId = query.clientId;
    if (query.operationalState) where.operationalState = query.operationalState as SaleOperationalState;
    if (query.cashShiftId) where.cashShiftId = query.cashShiftId;
    if (query.workstationId) where.workstationId = query.workstationId;
    if (query.confirmedAtFrom || query.confirmedAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.confirmedAtFrom) dateFilter.gte = new Date(query.confirmedAtFrom);
      if (query.confirmedAtTo) dateFilter.lte = new Date(query.confirmedAtTo);
      where.confirmedAt = dateFilter;
    }

    const [sales, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { startedAt: 'desc' },
        include: { items: true, payments: true, client: true, cashShift: true, workstation: true },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return { data: sales, total, page: query.page, pageSize: query.pageSize };
  }

  async findById(id: string): Promise<any> {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { items: { include: { lots: { include: { lot: true } } } }, payments: true, client: true, cashShift: true, workstation: true },
    });
    if (!sale) throw new SaleNotFoundException(id);
    return sale;
  }

  async create(createDto: CreateSaleDto, userId: string, workstationId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const cashShift = await this.getOpenCashShift(tx, userId, workstationId);
      const clientData = createDto.clientId ? await this.getClientSnapshot(tx, createDto.clientId) : null;
      const saleItems = await Promise.all(createDto.items.map(item => this.buildSaleItemFromRequest(tx, item, clientData?.classification?.discountPercentage)));

      const totalCalculations = this.calculateSaleTotals(saleItems as unknown as SaleItemTotals[]);

      let localNumber: bigint;
      for (let i = 0; i < 5; i++) { // Retry logic for unique constraint
        localNumber = await this.getNextLocalNumber(tx, workstationId);
        try {
          const sale = await tx.sale.create({
            data: {
              id: crypto.randomUUID(),
              localNumber,
              operationalState: SaleOperationalState.IN_PROGRESS,
              startedAt: new Date(),
              lastModifiedAt: new Date(),
              cashShiftId: cashShift.id,
              workstationId: cashShift.workstationId,
              userId,
              sourceWorkstationId: workstationId,
              clientIdentificationTypeSnapshot: clientData?.identificationType || null,
              clientIdentificationNumberSnapshot: clientData?.identificationNumber || null,
              clientNameSnapshot: clientData?.fullName || null,
              clientId: clientData?.id || null,
              clientClassificationIdSnapshot: clientData?.classification?.id || null,
              clientTypeSnapshot: clientData?.classification?.type || null,
              subtotal: totalCalculations.subtotal,
              totalDiscount: totalCalculations.totalDiscount,
              totalTax: totalCalculations.totalTax,
              totalAmount: totalCalculations.totalAmount,
              items: { create: saleItems.map(item => ({ ...item, saleItemPrescriptionId: null })) },
            },
            include: { items: true },
          });
          return sale;
        } catch (error: unknown) {
          const err = error as { code?: string; meta?: Record<string, unknown> };
          if (err.code === 'P2002' && err.meta?.target === 'ux_sale_local_per_ws') {
            // Unique constraint violation, retry
            continue;
          }
          throw error;
        }
      }
      throw new Error('Failed to create sale after multiple retries due to local number conflict.');
    });
  }

  async confirm(saleId: string, confirmDto: ConfirmSaleDto, userId: string): Promise<any> {
    let fiscalDocumentId: string | null = null;

    // Business validation: at least one payment is required.
    // Relocated from ConfirmSaleSchema (HTTP DTO) to the service layer
    // so that sync dispatcher replays are also protected.
    if (!confirmDto.payments || confirmDto.payments.length === 0) {
      throw new PaymentAmountMismatchException(0, 0);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: { include: { product: true } } },
      });

      if (!sale) throw new SaleNotFoundException(saleId);
      if (sale.operationalState !== SaleOperationalState.IN_PROGRESS) {
        throw new SaleNotInProgressException(saleId);
      }

      const totalPaid = confirmDto.payments.reduce((sum, p) => sum + p.amount, 0);
      if (totalPaid < sale.totalAmount.toNumber()) {
        throw new PaymentAmountMismatchException(sale.totalAmount.toNumber(), totalPaid);
      }

      const changeAmount = new Prisma.Decimal(totalPaid).minus(sale.totalAmount);
      if (changeAmount.greaterThan(0)) {
        const hasCashPayment = await this.hasCashPaymentMethod(tx, confirmDto.payments);
        if (!hasCashPayment) {
          throw new ChangeRequiresCashPaymentException();
        }
      }

      for (const item of sale.items) {
        const consumedLots = await this.lotsService.consumeStockForSale({
          productId: item.productId,
          quantity: item.quantity,
          saleId: sale.id,
          tx,
        });
        const weightedUnitCost = this.computeWeightedUnitCost(consumedLots);
        await tx.saleItem.update({
          where: { id: item.id },
          data: { unitCost: weightedUnitCost },
        });
        for (const cl of consumedLots) {
          await tx.saleItemLot.create({
            data: {
              id: crypto.randomUUID(),
              saleItemId: item.id,
              lotId: cl.lotId,
              quantity: cl.quantity,
              unitCostAtSale: cl.unitCostAtSale,
            },
          });
        }
      }

      await tx.salePayment.createMany({
        data: confirmDto.payments.map(p => ({
          id: crypto.randomUUID(),
          saleId: sale.id,
          paymentMethodId: p.paymentMethodId,
          amount: new Prisma.Decimal(p.amount),
          transactionReference: p.transactionReference,
          authorizationCode: p.authorizationCode,
          cardBrand: p.cardBrand,
          cardLastFour: p.cardLastFour,
          batchNumber: p.batchNumber,
          processorResponseCode: p.processorResponseCode,
        })),
      });

      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          operationalState: SaleOperationalState.CONFIRMED,
          confirmedAt: new Date(),
          lastModifiedAt: new Date(),
          changeAmount,
        },
        include: { payments: true },
      });

      // Fiscal document created inside the same transaction — if it fails,
      // the whole sale confirmation rolls back. A confirmed sale without a
      // fiscal document is not an acceptable partial state.
      const fiscalDoc = await this.fiscalDocumentsService.createPendingDocumentForSale({
        saleId,
        tx,
      });
      fiscalDocumentId = fiscalDoc.id;

      return updatedSale;
    });

    // Enqueue only after the transaction has committed successfully
    if (fiscalDocumentId) {
      await this.fiscalDocumentsService.enqueueGenerationJob(fiscalDocumentId);
    }

    return result;
  }

  async annul(id: string, dto: AnnulSaleDto, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id } });
      if (!sale) throw new SaleNotFoundException(id);
      if (sale.operationalState !== SaleOperationalState.CONFIRMED) {
        throw new SaleNotConfirmedException(id);
      }

      // Business validation: annulment reason is required.
      // Relocated from AnnulSaleSchema (HTTP DTO) to the service layer
      // so that sync dispatcher replays are also protected.
      if (!dto.annulmentReason || dto.annulmentReason.trim().length === 0) {
        throw new Error('Annulment reason is required');
      }

      // reverseStockForSale throws LotStateChangedSinceSaleException on EXPIRED/BLOCKED lots,
      // which propagates uncaught and rolls back the entire transaction untouched.
      await this.lotsService.reverseStockForSale({ saleId: id, tx });

      return tx.sale.update({
        where: { id },
        data: {
          operationalState: SaleOperationalState.ANNULLED,
          annulledAt: new Date(),
          annulledById: userId,
          annulmentReason: dto.annulmentReason,
          annulmentNotes: dto.annulmentNotes ?? null,
        },
      });
    });
  }

  private async getOpenCashShift(tx: Prisma.TransactionClient, userId: string, workstationId: string): Promise<any> {
    const cashShift = await tx.cashShift.findFirst({
      where: { userId, workstationId, state: ShiftState.OPEN },
    });
    if (!cashShift) {
      throw new CashShiftNotOpenForWorkstationException(workstationId);
    }
    return cashShift;
  }

  private async getClientSnapshot(tx: Prisma.TransactionClient, clientId: string): Promise<any> {
    return tx.client.findUnique({
      where: { id: clientId },
      include: { classification: true },
    });
  }

  private async buildSaleItemFromRequest(
    tx: Prisma.TransactionClient,
    itemDto: CreateSaleItemDto,
    clientDiscountPercentage: Prisma.Decimal = new Prisma.Decimal(0),
  ): Promise<Prisma.SaleItemCreateWithoutSaleInput> {
    const product = await tx.product.findUnique({
      where: { id: itemDto.productId },
      include: {
        priceHistories: { take: 1, orderBy: { effectiveFrom: 'desc' } },
        taxHistories: { include: { taxScheme: true }, take: 1, orderBy: { effectiveFrom: 'desc' } },
      },
    });

    if (!product) throw new ProductNotFoundException(itemDto.productId);
    if (product.saleType !== SaleType.FREE_SALE) {
      throw new PrescriptionRequiredNotSupportedException(itemDto.productId);
    }

    const priceHist = product.priceHistories?.[0];
    const taxHist = product.taxHistories?.[0];
    const unitPrice = priceHist?.price || new Prisma.Decimal(0);
    const taxRate = taxHist?.taxScheme?.rate || new Prisma.Decimal(0);

    const quantity = new Prisma.Decimal(itemDto.quantity);
    const itemSubtotal = unitPrice.times(quantity);

    let discountPercentage = itemDto.discountPercentage ? new Prisma.Decimal(itemDto.discountPercentage) : clientDiscountPercentage;
    if (itemDto.discountPercentage && itemDto.discountReason === undefined) {
      throw new DiscountReasonRequiredException();
    }

    const discountAmount = itemSubtotal.times(discountPercentage.dividedBy(100));
    const priceAfterDiscount = itemSubtotal.minus(discountAmount);
    const taxAmount = priceAfterDiscount.times(taxRate.dividedBy(100));
    const total = priceAfterDiscount.plus(taxAmount);

    return {
      id: crypto.randomUUID(),
      product: { connect: { id: itemDto.productId } },
      productInternalCodeSnapshot: product.internalCode,
      productCommercialNameSnapshot: product.commercialName,
      productGenericNameSnapshot: product.genericName,
      productConcentrationSnapshot: product.concentration,
      quantity: itemDto.quantity,
      unitPrice,
      taxRate,
      taxAmount,
      discountPercentage,
      discountAmount,
      discountReason: itemDto.discountReason || null,
      subtotal: itemSubtotal,
      total,
      requiresPrescription: false,
    };
  }

  private calculateSaleTotals(
    saleItems: SaleItemTotals[],
  ): {
    subtotal: Prisma.Decimal;
    totalDiscount: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const subtotal = saleItems.reduce((sum, item) => sum.plus(item.subtotal), new Prisma.Decimal(0));
    const totalDiscount = saleItems.reduce((sum, item) => sum.plus(item.discountAmount), new Prisma.Decimal(0));
    const totalTax = saleItems.reduce((sum, item) => sum.plus(item.taxAmount), new Prisma.Decimal(0));
    const totalAmount = saleItems.reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0));
    return { subtotal, totalDiscount, totalTax, totalAmount };
  }

  private async getNextLocalNumber(tx: Prisma.TransactionClient, workstationId: string): Promise<bigint> {
    const latestSale = await tx.sale.findFirst({
      where: { sourceWorkstationId: workstationId },
      orderBy: { localNumber: 'desc' },
      select: { localNumber: true },
    });
    return latestSale ? latestSale.localNumber + 1n : 1n;
  }

  private async hasCashPaymentMethod(tx: Prisma.TransactionClient, payments: z.infer<typeof PaymentInputSchema>[]): Promise<boolean> {
    for (const payment of payments) {
      const paymentMethod = await tx.paymentMethod.findUnique({
        where: { id: payment.paymentMethodId },
        select: { isCash: true },
      });
      if (paymentMethod?.isCash) return true;
    }
    return false;
  }

  private computeWeightedUnitCost(consumedLots: ConsumedLot[]): Prisma.Decimal {
    const totalQuantity = consumedLots.reduce((sum, cl) => sum + cl.quantity, 0);
    if (totalQuantity === 0) return new Prisma.Decimal(0);

    const totalCost = consumedLots.reduce((sum, cl) => sum.plus(cl.unitCostAtSale.times(cl.quantity)), new Prisma.Decimal(0));
    return totalCost.dividedBy(totalQuantity);
  }
}
