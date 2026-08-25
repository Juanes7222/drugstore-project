import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import {
  Prisma,
  SaleOperationalState,
  SaleType,
  ShiftState,
  IdentificationType,
  ClientType,
  AuditAction,
  SystemModule,
  CommissionType,
  ClientReturnState,
} from '@pharmacy/database';
import * as crypto from 'crypto';
import { CreateSaleDto, CreateSaleItemDto } from '../dto/create-sale.dto';
import { QuerySaleDto } from '../dto/query-sale.dto';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';
import { ConfirmSaleDto, PaymentInputSchema } from '../dto/confirm-sale.dto';
import { z } from 'zod';
import { SaleNotFoundException } from '../exceptions/sale-not-found.exception';
import { CashShiftNotOpenForWorkstationException } from '../exceptions/cash-shift-not-open-for-workstation.exception';
import { PrescriptionRequiredNotSupportedException } from '../exceptions/prescription-required-not-supported.exception';
import { PaymentAmountMismatchException } from '../exceptions/payment-amount-mismatch.exception';
import { ChangeRequiresCashPaymentException } from '../exceptions/change-requires-cash-payment.exception';
import { CreditRequiresRegisteredClientException } from '../exceptions/credit-requires-registered-client.exception';
import { CreditNotEnabledForClientException } from '../exceptions/credit-not-enabled-for-client.exception';
import { CreditLimitExceededException } from '../exceptions/credit-limit-exceeded.exception';
import { SaleNotInProgressException } from '../exceptions/sale-not-in-progress.exception';
import { SaleNotConfirmedException } from '../exceptions/sale-not-confirmed.exception';
import { AnnulSaleDto } from '../dto/annul-sale.dto';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { ConsumedLot } from '@/modules/inventory-lots/types/consume-stock.types';
import { LotNotFoundException } from '@/modules/inventory-lots/exceptions/lot-not-found.exception';
import { ProductNotFoundException } from '@/modules/catalog/exceptions/product-not-found.exception';
import { DiscountReasonRequiredException } from '@/modules/catalog/exceptions/discount-reason-required.exception';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';
import { CommissionCalculatorService } from './commission-calculator.service';
import { toDecimal } from '@/common/to-decimal';
import { GENERIC_CLIENT_UUID } from '@/modules/clients/constants/clients.constants';
import {
  SaleDeliveryInfoSchema,
  SaleDeliveryInfoInput,
} from '../dto/sale-delivery.schema';

interface SaleItemCalculations {
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountPercentage: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

type SaleItemTotals = {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
};

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
    private fiscalDocumentsService: FiscalDocumentsService,
    private commissionCalculatorService: CommissionCalculatorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Cursor mode walks (startedAt desc, id desc) so deep history pages stay
   * cheap on the fastest-growing table; the legacy offset path is kept for
   * clients that still send page/pageSize.
   */
  async findAll(query: QuerySaleDto): Promise<any> {
    const where: Prisma.SaleWhereInput = {};
    if (query.clientId) where.clientId = query.clientId;
    if (query.operationalState)
      where.operationalState = query.operationalState as SaleOperationalState;
    if (query.cashShiftId) where.cashShiftId = query.cashShiftId;
    if (query.workstationId) where.workstationId = query.workstationId;
    if (query.confirmedAtFrom || query.confirmedAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.confirmedAtFrom)
        dateFilter.gte = new Date(query.confirmedAtFrom);
      if (query.confirmedAtTo) dateFilter.lte = new Date(query.confirmedAtTo);
      where.confirmedAt = dateFilter;
    }

    const listInclude = {
      items: true,
      payments: true,
      client: true,
      cashShift: true,
      workstation: true,
    } satisfies Prisma.SaleInclude;

    if (query.cursor) {
      const page = await paginateWithCursor<
        unknown,
        Prisma.SaleWhereInput,
        Prisma.SaleOrderByWithRelationInput,
        Prisma.SaleInclude
      >({
        model: this.prisma.sale,
        baseWhere: where,
        limit: query.pageSize,
        cursor: query.cursor,
        timeField: 'startedAt',
        direction: 'desc',
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        include: listInclude,
      });
      return {
        data: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        pageSize: query.pageSize,
      };
    }

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        include: listInclude,
      }),
      this.prisma.sale.count({ where }),
    ]);
    return { data: sales, total, page: query.page, pageSize: query.pageSize };
  }

  async findById(id: string): Promise<any> {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: { include: { lots: { include: { lot: true } } } },
        payments: true,
        client: true,
        cashShift: true,
        workstation: true,
      },
    });
    if (!sale) throw new SaleNotFoundException(id);
    return sale;
  }

  async create(
    createDto: CreateSaleDto,
    userId: string,
    workstationId: string,
    sourceOperationUuid?: string,
  ): Promise<any> {
    // Validate the optional domicilio payload before opening the transaction so
    // an invalid shape fails fast and surfaces as a 400 (BadRequestException)
    // on both the HTTP path and the SALE_CONFIRMATION sync replay path.
    const delivery = this.parseDeliveryOrThrow(createDto.delivery);

    return this.prisma.$transaction(async (tx) => {
      const cashShift = await this.getOpenCashShift(
        tx,
        userId,
        workstationId,
        createDto.cashShiftId,
      );

      // Resolve client data: use the specified client, or fall back to the
      // DIAN-mandated generic consumer (CONSUMIDOR FINAL) so the invoice
      // always carries a buyer identification — never null snapshot fields.
      // The generic client record is seeded by migration
      // 20260730000001_seed_generic_client.
      const useGeneric = !createDto.clientId;
      const clientData = useGeneric
        ? await this.resolveGenericClient(tx)
        : await this.getClientSnapshot(tx, createDto.clientId!);
      const saleItems = await Promise.all(
        createDto.items.map((item) =>
          this.buildSaleItemFromRequest(
            tx,
            item,
            clientData?.classification?.discountPercentage,
          ),
        ),
      );

      const totalCalculations = this.calculateSaleTotals(
        saleItems as unknown as SaleItemTotals[],
      );

      // Offline-first: when the caller (the POS replay path) provides
      // pre-computed totals, use them as the authoritative sale-header
      // values. The server's recompute is preserved for direct HTTP API
      // callers and legacy sync payloads that do not carry totals. This
      // keeps the offline-recorded payment amount and the server-stored
      // total aligned even when the server's catalog has drifted from the
      // POS snapshot between sale time and sync time.
      const headerTotals = this.resolveHeaderTotals(
        createDto,
        totalCalculations,
      );

      // Serialize local number allocation for this workstation using a
      // PostgreSQL advisory transaction lock. This prevents concurrent sync
      // replays from reading the same MAX(localNumber) before either commits.
      const lockKey = this.hashWorkstationId(workstationId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

      let localNumber: bigint;
      for (let i = 0; i < 5; i++) {
        // Retry logic for unique constraint (belt-and-suspenders)
        localNumber = await this.getNextLocalNumber(tx, workstationId);
        try {
          const sale = await tx.sale.create({
            data: {
              id: crypto.randomUUID(),
              subscriptionId: this.tenantContext.getSubscriptionId(),
              localNumber,
              operationalState: SaleOperationalState.IN_PROGRESS,
              startedAt: new Date(),
              lastModifiedAt: new Date(),
              cashShiftId: cashShift.id,
              workstationId: cashShift.workstationId,
              userId,
              sourceWorkstationId: workstationId,
              sourceOperationUuid,
              clientIdentificationTypeSnapshot:
                clientData?.identificationType || null,
              clientIdentificationNumberSnapshot:
                clientData?.identificationNumber || null,
              clientNameSnapshot: clientData?.fullName || null,
              clientId: clientData?.id || null,
              clientClassificationIdSnapshot:
                clientData?.classification?.id || null,
              clientTypeSnapshot: clientData?.classification?.type || null,
              subtotal: headerTotals.subtotal,
              totalDiscount: headerTotals.totalDiscount,
              totalTax: headerTotals.totalTax,
              totalAmount: headerTotals.totalAmount,
              // Delivery JSON persisted verbatim from the payload; SQL NULL
              // when the sale is not a domicilio.
              delivery: delivery ?? Prisma.DbNull,
              items: {
                create: saleItems.map((item) => ({
                  ...item,
                  saleItemPrescriptionId: null,
                })),
              },
            },
            include: { items: true },
          });
          return sale;
        } catch (error: unknown) {
          const err = error as {
            code?: string;
            meta?: Record<string, unknown>;
            message?: string;
          };
          if (
            err.code === 'P2002' &&
            err.meta?.target === 'ux_sale_local_per_ws'
          ) {
            // Local number unique constraint violation — retry with next number.
            continue;
          }
          if (
            err.code === 'P2002' &&
            sourceOperationUuid &&
            this.isSourceOperationUuidConflict(err)
          ) {
            // Another concurrent transaction already created a sale with this
            // sourceOperationUuid.  Fetch and return the existing one instead of
            // failing — the caller's idempotency guard also covers this case,
            // but a race between the guard read and this create can still happen.
            const existing = await tx.sale.findUnique({
              where: { sourceOperationUuid },
              include: { items: true },
            });
            if (existing) return existing;
            // else fall through and throw — unexpected inconsistency.
          }
          throw error;
        }
      }
      throw new Error(
        'Failed to create sale after multiple retries due to local number conflict.',
      );
    });
  }

  async confirm(
    saleId: string,
    confirmDto: ConfirmSaleDto,
    userId: string,
  ): Promise<any> {
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

      const totalPaid = confirmDto.payments.reduce(
        (sum, p) => sum + p.amount,
        0,
      );
      // A domicilio sale charges the item total plus the delivery fee —
      // the POS validates the same way locally (totalAmount + feeCents).
      const deliveryFee = this.deliveryFeeAmount(sale.delivery);
      const amountDue = sale.totalAmount.plus(deliveryFee);
      if (totalPaid < amountDue.toNumber()) {
        throw new PaymentAmountMismatchException(
          amountDue.toNumber(),
          totalPaid,
        );
      }

      const changeAmount = new Prisma.Decimal(totalPaid).minus(amountDue);
      if (changeAmount.greaterThan(0)) {
        const hasCashPayment = await this.hasCashPaymentMethod(
          tx,
          confirmDto.payments,
        );
        if (!hasCashPayment) {
          throw new ChangeRequiresCashPaymentException();
        }
      }

      // ---- Store credit validation ----
      // A CREDIT payment is only allowed for a registered client (never the
      // generic consumer) whose current credit debt stays within their limit
      // after this payment. Runs inside the same transaction so the balance
      // check and the payment insert are atomic.
      const creditTotal = await this.sumCreditPayments(tx, confirmDto.payments);
      if (creditTotal.greaterThan(0)) {
        const isRegisteredClient =
          !!sale.clientId && sale.clientId !== GENERIC_CLIENT_UUID;
        if (!isRegisteredClient) {
          throw new CreditRequiresRegisteredClientException();
        }

        const client = await tx.client.findUnique({
          where: { id: sale.clientId! },
          select: { creditLimit: true },
        });
        const creditLimit = client?.creditLimit ?? null;
        if (!creditLimit || creditLimit.lessThanOrEqualTo(0)) {
          throw new CreditNotEnabledForClientException(sale.clientId!);
        }

        const currentDebt = await this.computeClientCreditDebt(
          tx,
          sale.clientId!,
        );
        const available = creditLimit.minus(currentDebt);
        if (creditTotal.greaterThan(available)) {
          throw new CreditLimitExceededException(
            available.toNumber(),
            creditTotal.toNumber(),
          );
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
              subscriptionId: this.tenantContext.getSubscriptionId(),
              saleItemId: item.id,
              lotId: cl.lotId,
              quantity: cl.quantity,
              unitCostAtSale: cl.unitCostAtSale,
            },
          });
        }
      }

      await tx.salePayment.createMany({
        data: confirmDto.payments.map((p) => ({
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
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
      const fiscalDoc =
        await this.fiscalDocumentsService.createPendingDocumentForSale({
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

  /**
   * Resolve the cash shift a sale belongs to.
   *
   * Prefers the open shift for (userId, workstationId).  When no open shift
   * exists (e.g. a sync replay that arrives after the shift was already
   * closed), falls back to the shift the POS recorded at sale time, provided
   * it belongs to the same user and workstation.
   */
  private async getOpenCashShift(
    tx: Prisma.TransactionClient,
    userId: string,
    workstationId: string,
    fallbackCashShiftId?: string,
  ): Promise<any> {
    // 1. Happy path — shift is still open
    const openShift = await tx.cashShift.findFirst({
      where: { userId, workstationId, state: ShiftState.OPEN },
    });
    if (openShift) return openShift;

    // 2. Fallback — shift was closed between local creation and sync replay
    if (fallbackCashShiftId) {
      const closedShift = await tx.cashShift.findFirst({
        where: {
          id: fallbackCashShiftId,
          userId,
          workstationId,
          state: ShiftState.CLOSED,
        },
      });
      if (closedShift) return closedShift;
    }

    // 3. No shift at all — refuse
    throw new CashShiftNotOpenForWorkstationException(workstationId);
  }

  private async getClientSnapshot(
    tx: Prisma.TransactionClient,
    clientId: string,
  ): Promise<any> {
    return tx.client.findUnique({
      where: { id: clientId },
      include: { classification: true },
    });
  }

  /**
   * Resolve the DIAN-mandated generic consumer (CONSUMIDOR FINAL) record.
   *
   * Looks up the well-known GENERIC_CLIENT_UUID from the database.  If the
   * seeded record is missing (e.g. before migration runs), returns inline
   * DIAN-standard defaults so the sale still carries a valid buyer
   * identification instead of null snapshot fields.
   */
  private async resolveGenericClient(tx: Prisma.TransactionClient): Promise<{
    id: string | null;
    identificationType: string;
    identificationNumber: string;
    fullName: string;
    classification: {
      id: string | null;
      type: string | null;
      discountPercentage: Prisma.Decimal;
    } | null;
  }> {
    const record = await tx.client.findUnique({
      where: { id: GENERIC_CLIENT_UUID },
      include: { classification: true },
    });

    if (record) {
      return {
        id: record.id,
        identificationType: record.identificationType,
        identificationNumber: record.identificationNumber,
        fullName: record.fullName,
        classification: record.classification
          ? {
              id: record.classification.id,
              type: record.classification.type,
              discountPercentage: new Prisma.Decimal(
                record.classification.discountPercentage.toString(),
              ),
            }
          : null,
      };
    }

    // Fallback: DIAN-standard generic consumer snapshot values when the
    // seeded record is not yet in the database (migration not run / test env).
    // `id` is null to avoid a FK violation against Client — the snapshots
    // are what DIAN requires on the invoice, not the FK itself.
    return {
      id: null,
      identificationType: 'NIT' as const,
      identificationNumber: '222222222222',
      fullName: 'CONSUMIDOR FINAL',
      classification: null,
    };
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
        taxHistories: {
          include: { taxScheme: true },
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
        },
      },
    });

    if (!product) throw new ProductNotFoundException(itemDto.productId);
    if (product.saleType !== SaleType.FREE_SALE) {
      throw new PrescriptionRequiredNotSupportedException(itemDto.productId);
    }

    const priceHist = product.priceHistories?.[0];
    const taxHist = product.taxHistories?.[0];
    // Offline-first: prefer the POS-snapshotted unitPrice when present.
    // The customer was charged at this price at sale time; using the
    // server's current price here would produce per-item totals that
    // diverge from the POS-recorded payment whenever the catalog has
    // drifted between sale and sync (the gap that manifested as
    // `Total payments (X) do not match total sale amount (Y)` sync
    // failures). Fall back to the server's current price only when the
    // POS did not provide one (direct HTTP API callers, legacy payloads).
    const unitPrice = itemDto.unitPrice
      ? toDecimal(itemDto.unitPrice, { fieldName: 'items[].unitPrice' })
      : (priceHist?.price ?? new Prisma.Decimal(0));
    const taxRate = taxHist?.taxScheme?.rate || new Prisma.Decimal(0);

    const quantity = new Prisma.Decimal(itemDto.quantity);
    const itemSubtotal = unitPrice.times(quantity);

    const discountPercentage = itemDto.discountPercentage
      ? new Prisma.Decimal(itemDto.discountPercentage)
      : clientDiscountPercentage;
    if (itemDto.discountPercentage && itemDto.discountReason === undefined) {
      throw new DiscountReasonRequiredException();
    }

    // Round each component to whole centavos (2 dp) exactly like the POS
    // (which mirrors its cents-based UI). Without per-item rounding the
    // exact Decimal sum can drift from the payment amount by a cent or
    // more, making credit-only payments look overpaid and throwing
    // ChangeRequiresCashPaymentException at confirm time.
    const discountAmount = itemSubtotal
      .times(discountPercentage.dividedBy(100))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const priceAfterDiscount = itemSubtotal.minus(discountAmount);
    const taxAmount = priceAfterDiscount
      .times(taxRate.dividedBy(100))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const total = priceAfterDiscount
      .plus(taxAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const commission = this.resolveCommission(
      itemDto,
      product,
      unitPrice,
      quantity,
      discountAmount,
    );

    return {
      id: crypto.randomUUID(),
      subscriptionId: this.tenantContext.getSubscriptionId(),
      product: { connect: { id: itemDto.productId } },
      productInternalCodeSnapshot: product.internalCode,
      productCommercialNameSnapshot: product.commercialName,
      // Product no longer carries a generic name; the snapshot column is
      // kept (nullable) only for historical fiscal documents.
      productGenericNameSnapshot: null,
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
      ...commission,
    };
  }

  /**
   * Decide the commission snapshots for one sale line.
   *
   * The offline POS evaluated the commission at real sale time, so when the
   * payload item carries any of the three commission fields those values are
   * persisted verbatim (client-authoritative). Direct HTTP API sales and
   * legacy payloads omit them — the server then recomputes with the same
   * rules: active only while the product commission type is not NONE, the
   * value is positive, and the sale moment falls inside the configured
   * window. An expired window never blocks the sale; it just yields no
   * commission.
   */
  private resolveCommission(
    itemDto: CreateSaleItemDto,
    product: {
      commissionType: CommissionType;
      commissionValue: Prisma.Decimal;
      commissionStartsAt: Date | null;
      commissionEndsAt: Date | null;
    },
    unitPrice: Prisma.Decimal,
    quantity: Prisma.Decimal,
    discountAmount: Prisma.Decimal,
  ): {
    commissionTypeSnapshot: CommissionType | null;
    commissionValueSnapshot: Prisma.Decimal | null;
    commissionAmount: Prisma.Decimal;
  } {
    const carriesPayloadValues =
      itemDto.commissionType !== undefined ||
      itemDto.commissionValue !== undefined ||
      itemDto.commissionAmount !== undefined;

    if (!carriesPayloadValues) {
      return this.commissionCalculatorService.compute(
        {
          commissionType: product.commissionType,
          commissionValue: product.commissionValue,
          commissionStartsAt: product.commissionStartsAt,
          commissionEndsAt: product.commissionEndsAt,
        },
        { unitPrice, quantity: quantity.toNumber(), discountAmount },
      );
    }

    return {
      commissionTypeSnapshot: itemDto.commissionType ?? null,
      commissionValueSnapshot:
        itemDto.commissionValue === undefined ||
        itemDto.commissionValue === null
          ? null
          : toDecimal(itemDto.commissionValue, {
              fieldName: 'items[].commissionValue',
            }),
      commissionAmount: toDecimal(itemDto.commissionAmount ?? '0', {
        fieldName: 'items[].commissionAmount',
      }),
    };
  }

  /**
   * Decide which totals to store on the sale header. When the DTO carries
   * the full set of pre-computed totals (the offline-first sync path),
   * trust them — they are what the customer actually paid. Otherwise
   * fall back to the server's recompute from the per-item breakdown
   * (direct HTTP API, legacy payloads).
   */
  private resolveHeaderTotals(
    createDto: CreateSaleDto,
    computed: {
      subtotal: Prisma.Decimal;
      totalDiscount: Prisma.Decimal;
      totalTax: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
    },
  ): {
    subtotal: Prisma.Decimal;
    totalDiscount: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const hasAll =
      createDto.subtotal !== undefined &&
      createDto.totalDiscount !== undefined &&
      createDto.totalTax !== undefined &&
      createDto.totalAmount !== undefined;
    if (!hasAll) return computed;

    return {
      subtotal: toDecimal(createDto.subtotal!, { fieldName: 'subtotal' }),
      totalDiscount: toDecimal(createDto.totalDiscount!, {
        fieldName: 'totalDiscount',
      }),
      totalTax: toDecimal(createDto.totalTax!, { fieldName: 'totalTax' }),
      totalAmount: toDecimal(createDto.totalAmount!, {
        fieldName: 'totalAmount',
      }),
    };
  }

  /**
   * Validates the optional domicilio payload for both the HTTP and the sync
   * replay path. Null/absent means the sale is not a domicilio. Invalid
   * shapes are rejected with a 400 (BadRequestException) so the POS maps the
   * failure to a VALIDATION category without leaking server internals.
   */
  private parseDeliveryOrThrow(
    delivery: CreateSaleDto['delivery'],
  ): SaleDeliveryInfoInput | null {
    if (delivery === undefined || delivery === null) return null;
    const result = SaleDeliveryInfoSchema.safeParse(delivery);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `delivery.${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new BadRequestException(`Delivery validation failed: ${detail}`);
    }
    return result.data;
  }

  /**
   * Delivery fee in COP pesos for a sale's stored delivery JSON. The fee is a
   * surcharge on top of the item total — the POS charges totalAmount +
   * feeCents, so the confirmation gate must compare paid against the same
   * amount. Malformed or absent delivery JSON yields 0 (no fee).
   */
  private deliveryFeeAmount(delivery: Prisma.JsonValue | null): Prisma.Decimal {
    if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
      return new Prisma.Decimal(0);
    }
    const feeCents = (delivery as Record<string, unknown>).feeCents;
    if (
      typeof feeCents !== 'number' ||
      !Number.isFinite(feeCents) ||
      feeCents < 0
    ) {
      return new Prisma.Decimal(0);
    }
    return new Prisma.Decimal(feeCents).dividedBy(100);
  }

  private calculateSaleTotals(saleItems: SaleItemTotals[]): {
    subtotal: Prisma.Decimal;
    totalDiscount: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const subtotal = saleItems.reduce(
      (sum, item) => sum.plus(item.subtotal),
      new Prisma.Decimal(0),
    );
    const totalDiscount = saleItems.reduce(
      (sum, item) => sum.plus(item.discountAmount),
      new Prisma.Decimal(0),
    );
    const totalTax = saleItems.reduce(
      (sum, item) => sum.plus(item.taxAmount),
      new Prisma.Decimal(0),
    );
    const totalAmount = saleItems.reduce(
      (sum, item) => sum.plus(item.total),
      new Prisma.Decimal(0),
    );
    return { subtotal, totalDiscount, totalTax, totalAmount };
  }

  /** Deterministic integer hash of a workstation ID for advisory lock key. */
  private hashWorkstationId(workstationId: string): number {
    let hash = 0;
    for (let i = 0; i < workstationId.length; i++) {
      hash = ((hash << 5) - hash + workstationId.charCodeAt(i)) | 0;
    }
    // Ensure positive integer within int4 range
    return hash & 0x7fffffff;
  }

  private async getNextLocalNumber(
    tx: Prisma.TransactionClient,
    workstationId: string,
  ): Promise<bigint> {
    const latestSale = await tx.sale.findFirst({
      where: { sourceWorkstationId: workstationId },
      orderBy: { localNumber: 'desc' },
      select: { localNumber: true },
    });
    return latestSale ? latestSale.localNumber + 1n : 1n;
  }

  /**
   * Sum of payment amounts whose payment method category is CREDIT.
   *
   * Non-existent payment method IDs are ignored (they fail later at the FK
   * constraint); only confirmed CREDIT-category methods count toward the
   * credit balance check.
   */
  private async sumCreditPayments(
    tx: Prisma.TransactionClient,
    payments: z.infer<typeof PaymentInputSchema>[],
  ): Promise<Prisma.Decimal> {
    const ids = [...new Set(payments.map((p) => p.paymentMethodId))];
    const methods = await tx.paymentMethod.findMany({
      where: { id: { in: ids } },
      select: { id: true, category: true },
    });
    const creditMethodIds = new Set(
      methods.filter((m) => m.category === 'CREDIT').map((m) => m.id),
    );
    return payments.reduce(
      (sum, p) =>
        creditMethodIds.has(p.paymentMethodId) ? sum.plus(p.amount) : sum,
      new Prisma.Decimal(0),
    );
  }

  /**
   * Current credit debt for a client in COP.
   *
   * Debt = sum of confirmed (non-annulled) sales paid with the CREDIT
   * payment method minus confirmed client returns refunded via the CREDIT
   * method minus recorded abonos (ClientCreditPayment). Returns are capped
   * at 0 — a client can never have a negative balance from over-refunds or
   * overpayments.
   */
  private async computeClientCreditDebt(
    tx: Prisma.TransactionClient,
    clientId: string,
  ): Promise<Prisma.Decimal> {
    const creditDebt = await tx.salePayment.aggregate({
      where: {
        sale: {
          clientId,
          operationalState: SaleOperationalState.CONFIRMED,
        },
        paymentMethod: { category: 'CREDIT' },
      },
      _sum: { amount: true },
    });
    const creditRefunds = await tx.clientReturn.aggregate({
      where: {
        clientId,
        state: ClientReturnState.CONFIRMED,
        refundMethod: { category: 'CREDIT' },
      },
      _sum: { refundAmount: true },
    });
    const creditPayments = await tx.clientCreditPayment.aggregate({
      where: { clientId, annulledAt: null },
      _sum: { amount: true },
    });
    const debt = (creditDebt._sum.amount ?? new Prisma.Decimal(0))
      .minus(creditRefunds._sum.refundAmount ?? new Prisma.Decimal(0))
      .minus(creditPayments._sum.amount ?? new Prisma.Decimal(0));
    return Prisma.Decimal.max(debt, new Prisma.Decimal(0));
  }

  private async hasCashPaymentMethod(
    tx: Prisma.TransactionClient,
    payments: z.infer<typeof PaymentInputSchema>[],
  ): Promise<boolean> {
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
    const totalQuantity = consumedLots.reduce(
      (sum, cl) => sum + cl.quantity,
      0,
    );
    if (totalQuantity === 0) return new Prisma.Decimal(0);

    const totalCost = consumedLots.reduce(
      (sum, cl) => sum.plus(cl.unitCostAtSale.times(cl.quantity)),
      new Prisma.Decimal(0),
    );
    return totalCost.dividedBy(totalQuantity);
  }

  /**
   * Check whether a Prisma P2002 error is a unique constraint violation on
   * the `sourceOperationUuid` field.  Uses a best-effort heuristic on the
   * error message because Prisma may report the constraint name
   * (`Sale_sourceOperationUuid_key`) or the field name (`sourceOperationUuid`)
   * depending on the engine version.
   */
  private isSourceOperationUuidConflict(error: {
    code?: string;
    meta?: Record<string, unknown>;
    message?: string;
  }): boolean {
    if (error.meta?.target === 'sourceOperationUuid') return true;
    if (error.meta?.target === 'Sale_sourceOperationUuid_key') return true;
    if (error.message?.includes('sourceOperationUuid')) return true;
    return false;
  }
}
