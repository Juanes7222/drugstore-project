/**
 * Local sales-pos service for the POS desktop app.
 *
 * Ported from the server-side SalesService in apps/server/src/modules/sales-pos.
 * Only FREE_SALE operations are supported locally — Prescription-based sales
 * and ClientReturns are deferred on both sides.
 *
 * ## Architecture notes
 *
 * ### SyncQueue integration
 * When a sale is confirmed locally, a SyncQueue row is created with
 * operationType SALE_CONFIRMATION in the same transaction. The payload
 * carries everything the server-side `create` and `confirm` endpoints
 * need to replay this sale for real on the next online sync. The sync
 * queue entry is produced here but the mechanism that reads and pushes
 * it to the server is a separate concern (the sync scheduler).
 *
 * ### unitCostAtSale — provisional value
 * Inherited from InventoryLotsService: unitCostAtSale is 0 because
 * PurchaseReceptionItem (the only source of real cost) is server-only.
 * See the inventory-lots module's module-level comment for the full
 * rationale. The provisional local figure is discarded and replaced
 * when sync replays the sale against the server.
 */
import { PrismaClient, Prisma, SaleOperationalState, SaleType, ShiftState } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import type { InventoryLotsService, ConsumedLot } from '../inventory-lots/inventory-lots.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  SaleNotInProgressException,
  PrescriptionRequiredNotSupportedException,
  PaymentAmountMismatchException,
  ChangeRequiresCashPaymentException,
  SaleNotFoundException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export interface CreateSaleItemInput {
  productId: string;
  quantity: number;
  /** Optional price override. When omitted, the latest catalog cached price
   *  (ProductPriceHistory) is used — matching the server-side behaviour. */
  unitPrice?: Prisma.Decimal;
  /** Discount as a percentage, e.g. 10 for 10 %. */
  discountPercentage?: number;
  /** Required when `discountPercentage > 0`. */
  discountReason?: string;
}

export interface CreateSaleInput {
  /** Optional client attached to the sale. */
  clientId?: string | null;
  /** Line items. At least one is required. */
  items: CreateSaleItemInput[];
}

export interface PaymentInput {
  paymentMethodId: string;
  amount: number;
  transactionReference?: string;
  authorizationCode?: string;
  cardBrand?: string;
  cardLastFour?: string;
  batchNumber?: string;
  processorResponseCode?: string;
}

export interface ConfirmSaleInput {
  /** At least one payment is required. */
  payments: PaymentInput[];
}

// ---------------------------------------------------------------------------
// Internal calculation types
// ---------------------------------------------------------------------------

interface ProductSnapshot {
  internalCode: string;
  commercialName: string;
  genericName: string;
  concentration: string | null;
}

interface BuiltSaleItem {
  productId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountPercentage: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  discountReason: string | null;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
  productSnapshot: ProductSnapshot;
}

/** Narrow shape for `calculateSaleTotals` input. */
interface SaleItemTotals {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

interface SaleTotals {
  subtotal: Prisma.Decimal;
  totalDiscount: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSalesPosService = (
  prisma: PrismaClient,
  auth: AuthService,
  inventoryLots: InventoryLotsService,
): SalesPosService => {
  return new SalesPosService(prisma, auth, inventoryLots);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SalesPosService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
    private readonly inventoryLots: InventoryLotsService,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Create a sale in IN_PROGRESS state.
   *
   * Requires CASHIER or ADMIN role.
   *
   * 1. Looks up the open cash shift for the current session's workstation.
   * 2. Optionally loads client snapshot (with classification discount).
   * 3. For each item: looks up product from local catalog cache, validates
   *    that `saleType === FREE_SALE`, resolves price from the latest
   *    `ProductPriceHistory` (or explicit override), resolves tax from
   *    the latest `ProductTaxHistory`, computes totals.
   * 4. Computes sale-level totals.
   * 5. Generates a sequential `localNumber` per workstation (with retry
   *    for the `ux_sale_local_per_ws` unique constraint).
   * 6. Creates the `Sale` and its `SaleItem` rows.
   *
   * No stock is touched during create — stock is consumed on `confirm`.
   *
   * @throws PrescriptionRequiredNotSupportedException if any item.product.saleType
   *   is not FREE_SALE.
   */
  async create(input: CreateSaleInput): Promise<unknown> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      const cashShift = await this.getOpenCashShift(tx, session.userId, session.workstationId);

      const clientData = input.clientId
        ? await this.getClientSnapshot(tx, input.clientId)
        : null;

      const clientDiscountPct = clientData?.classification?.discountPercentage
        ? new Prisma.Decimal(clientData.classification.discountPercentage.toString())
        : new Prisma.Decimal(0);

      const saleItems: BuiltSaleItem[] = await Promise.all(
        input.items.map((item) =>
          this.buildSaleItemFromRequest(tx, item, clientDiscountPct),
        ),
      );

      const totals: SaleTotals = this.calculateSaleTotals(
        saleItems as unknown as SaleItemTotals[],
      );

      // Retry loop for the `ux_sale_local_per_ws` unique constraint
      for (let attempt = 0; attempt < 5; attempt++) {
        const localNumber = await this.getNextLocalNumber(tx, session.workstationId);
        try {
          const sale = await tx.sale.create({
            data: {
              id: globalThis.crypto.randomUUID(),
              localNumber,
              operationalState: SaleOperationalState.IN_PROGRESS,
              startedAt: new Date(),
              lastModifiedAt: new Date(),
              cashShiftId: cashShift.id,
              workstationId: session.workstationId,
              userId: session.userId,
              sourceWorkstationId: session.workstationId,
              clientIdentificationTypeSnapshot: clientData?.identificationType ?? null,
              clientIdentificationNumberSnapshot: clientData?.identificationNumber ?? null,
              clientNameSnapshot: clientData?.fullName ?? null,
              clientId: clientData?.id ?? null,
              clientClassificationIdSnapshot: clientData?.classification?.id ?? null,
              clientTypeSnapshot: clientData?.classification?.type ?? null,
              subtotal: totals.subtotal,
              totalDiscount: totals.totalDiscount,
              totalTax: totals.totalTax,
              totalAmount: totals.totalAmount,
              items: {
                create: saleItems.map((item) => ({
                  id: globalThis.crypto.randomUUID(),
                  productId: item.productId,
                  productInternalCodeSnapshot: item.productSnapshot.internalCode,
                  productCommercialNameSnapshot: item.productSnapshot.commercialName,
                  productGenericNameSnapshot: item.productSnapshot.genericName,
                  productConcentrationSnapshot: item.productSnapshot.concentration,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  taxRate: item.taxRate,
                  taxAmount: item.taxAmount,
                  discountPercentage: item.discountPercentage,
                  discountAmount: item.discountAmount,
                  discountReason: item.discountReason,
                  subtotal: item.subtotal,
                  total: item.total,
                  requiresPrescription: false,
                })),
              },
            },
            include: { items: true },
          });
          return sale;
        } catch (error: unknown) {
          const err = error as { code?: string; meta?: { target?: string } };
          if (err.code === 'P2002' && err.meta?.target === 'ux_sale_local_per_ws') {
            // Unique constraint violation — another concurrent create grabbed
            // the same localNumber. Retry with the next available number.
            continue;
          }
          throw error;
        }
      }
      throw new Error('Failed to create sale after multiple retries due to local number conflict.');
    });
  }

  /**
   * Confirm a sale — consume stock, record payments, and enqueue sync.
   *
   * Requires CASHIER or ADMIN role.
   *
   * 1. Validates the sale exists and is in IN_PROGRESS state.
   * 2. Validates that total payments >= sale.totalAmount.
   * 3. If overpaid (change due), requires at least one cash payment method.
   * 4. For each sale item: calls `inventoryLots.consumeStockForSale()` to
   *    decrement lots in FEFO order, computes the quantity-weighted average
   *    unitCost, creates SaleItemLot records with the provisional cost.
   * 5. Creates SalePayment records for each payment input.
   * 6. Transitions the sale to CONFIRMED with changeAmount and confirmedAt.
   * 7. Inserts a SyncQueue row (operationType: SALE_CONFIRMATION) with the
   *    payload the server needs to replay this sale.
   *
   * All of the above happens inside a single Prisma transaction.
   *
   * @throws SaleNotFoundException         when the sale does not exist.
   * @throws SaleNotInProgressException     when the sale is not IN_PROGRESS.
   * @throws PaymentAmountMismatchException  when payments < totalAmount.
   * @throws ChangeRequiresCashPaymentException when change is due but no cash
   *   payment method is present.
   */
  async confirm(saleId: string, input: ConfirmSaleInput): Promise<unknown> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      // 1. Find and validate sale
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: true },
      });

      if (!sale) throw new SaleNotFoundException(saleId);
      if (sale.operationalState !== SaleOperationalState.IN_PROGRESS) {
        throw new SaleNotInProgressException(saleId);
      }

      // 2. Validate payments
      const totalPaid = input.payments.reduce((sum, p) => sum + p.amount, 0);
      const saleTotal = Number(sale.totalAmount.toString());

      if (totalPaid < saleTotal) {
        throw new PaymentAmountMismatchException(saleTotal, totalPaid);
      }

      const changeAmount = new Prisma.Decimal(totalPaid).minus(sale.totalAmount);
      if (changeAmount.greaterThan(0)) {
        const hasCash = await this.hasAnyCashPaymentMethod(tx, input.payments);
        if (!hasCash) {
          throw new ChangeRequiresCashPaymentException();
        }
      }

      // 3. Consume stock for each item
      for (const item of sale.items) {
        const consumedLots = await this.inventoryLots.consumeStockForSale({
          productId: item.productId,
          quantity: item.quantity,
          saleId: sale.id,
        });

        const weightedUnitCost = this.computeWeightedUnitCost(consumedLots);

        await tx.saleItem.update({
          where: { id: item.id },
          data: { unitCost: weightedUnitCost },
        });

        for (const cl of consumedLots) {
          await tx.saleItemLot.create({
            data: {
              id: globalThis.crypto.randomUUID(),
              saleItemId: item.id,
              lotId: cl.lotId,
              quantity: cl.quantity,
              unitCostAtSale: cl.unitCostAtSale,
            },
          });
        }
      }

      // 4. Create payment records
      await tx.salePayment.createMany({
        data: input.payments.map((p) => ({
          id: globalThis.crypto.randomUUID(),
          saleId: sale.id,
          paymentMethodId: p.paymentMethodId,
          amount: new Prisma.Decimal(p.amount),
          transactionReference: p.transactionReference ?? null,
          authorizationCode: p.authorizationCode ?? null,
          cardBrand: p.cardBrand ?? null,
          cardLastFour: p.cardLastFour ?? null,
          batchNumber: p.batchNumber ?? null,
          processorResponseCode: p.processorResponseCode ?? null,
        })),
      });

      // 5. Update sale to CONFIRMED
      const confirmedAt = new Date();
      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          operationalState: SaleOperationalState.CONFIRMED,
          confirmedAt,
          lastModifiedAt: confirmedAt,
          changeAmount,
        },
      });

      // 6. Insert SyncQueue entry inside the same transaction
      await this.createSyncQueueEntry(tx, sale, input, session, confirmedAt);

      return updatedSale;
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Find the open cash shift for the given user and workstation.
   *
   * Reuses the same state check pattern as CashShiftService (querying
   * CashShift with state === OPEN) rather than importing the service's
   * private method.
   */
  private async getOpenCashShift(
    tx: Prisma.TransactionClient,
    userId: string,
    workstationId: string,
  ): Promise<{ id: string; workstationId: string }> {
    const cashShift = await tx.cashShift.findFirst({
      where: { userId, workstationId, state: ShiftState.OPEN },
      select: { id: true, workstationId: true },
    });
    if (!cashShift) {
      throw new Error(`No open cash shift found for workstation ${workstationId}.`);
    }
    return cashShift;
  }

  /**
   * Load a client's snapshot data including their classification discount.
   */
  private async getClientSnapshot(
    tx: Prisma.TransactionClient,
    clientId: string,
  ) {
    return tx.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        identificationType: true,
        identificationNumber: true,
        fullName: true,
        classification: {
          select: { id: true, type: true, discountPercentage: true },
        },
      },
    });
  }

  /**
   * Resolve a single sale item from the request: validate product, read
   * price and tax from the local catalog cache, compute discount and tax
   * amounts.
   *
   * Mirrors the server's `buildSaleItemFromRequest` exactly, but returns
   * a plain object instead of a Prisma input type, since there is no
   * NestJS dependency.
   */
  private async buildSaleItemFromRequest(
    tx: Prisma.TransactionClient,
    item: CreateSaleItemInput,
    clientDiscountPercentage: Prisma.Decimal,
  ): Promise<BuiltSaleItem> {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        internalCode: true,
        commercialName: true,
        genericName: true,
        concentration: true,
        saleType: true,
        priceHistories: {
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
          select: { price: true },
        },
        taxHistories: {
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
          select: {
            taxScheme: { select: { rate: true } },
          },
        },
      },
    });

    if (!product) {
      throw new Error(`Product with ID ${item.productId} not found.`);
    }

    if (product.saleType !== SaleType.FREE_SALE) {
      throw new PrescriptionRequiredNotSupportedException(item.productId);
    }

    // Resolve unit price: use the explicit override if provided, otherwise
    // read from the latest PriceHistory.  This matches the server's behaviour
    // of always using the latest catalog price.
    const unitPrice = item.unitPrice
      ?? (product.priceHistories[0]?.price ?? new Prisma.Decimal(0));

    const taxRate = product.taxHistories[0]?.taxScheme?.rate
      ?? new Prisma.Decimal(0);

    const quantity = new Prisma.Decimal(item.quantity);
    const itemSubtotal = unitPrice.times(quantity);

    // Discount: use the explicit item discount if given, otherwise fall
    // back to the client's classification discount (which defaults to 0).
    let discountPercentage: Prisma.Decimal;
    let discountReason: string | null;

    if (item.discountPercentage !== undefined) {
      discountPercentage = new Prisma.Decimal(item.discountPercentage);
      discountReason = item.discountReason ?? null;
      if (discountPercentage.greaterThan(0) && !discountReason) {
        throw new Error(`Discount reason is required for product ${item.productId} when discountPercentage > 0.`);
      }
    } else {
      discountPercentage = clientDiscountPercentage;
      discountReason = null;
    }

    const discountAmount = itemSubtotal.times(discountPercentage).dividedBy(100);
    const priceAfterDiscount = itemSubtotal.minus(discountAmount);
    const taxAmount = priceAfterDiscount.times(taxRate).dividedBy(100);
    const total = priceAfterDiscount.plus(taxAmount);

    return {
      productId: product.id,
      quantity: item.quantity,
      unitPrice,
      taxRate,
      taxAmount,
      discountPercentage,
      discountAmount,
      discountReason,
      subtotal: itemSubtotal,
      total,
      productSnapshot: {
        internalCode: product.internalCode,
        commercialName: product.commercialName,
        genericName: product.genericName,
        concentration: product.concentration,
      },
    };
  }

  /**
   * Compute sale-level totals from the per-item calculations.
   */
  private calculateSaleTotals(saleItems: SaleItemTotals[]): SaleTotals {
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

  /**
   * Get the next sequential `localNumber` for the given workstation.
   *
   * Reads the maximum existing `localNumber` for this `sourceWorkstationId`
   * and returns it + 1, defaulting to 1 when no sales exist yet.
   */
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
   * Check whether at least one of the given payment methods has `isCash = true`.
   */
  private async hasAnyCashPaymentMethod(
    tx: Prisma.TransactionClient,
    payments: PaymentInput[],
  ): Promise<boolean> {
    for (const payment of payments) {
      const pm = await tx.paymentMethod.findUnique({
        where: { id: payment.paymentMethodId },
        select: { isCash: true },
      });
      if (pm?.isCash) return true;
    }
    return false;
  }

  /**
   * Compute the quantity-weighted average `unitCost` from consumed lots.
   *
   * Since all local `unitCostAtSale` values are provisional 0 (see the
   * inventory-lots module comment), this will always return 0.  The
   * calculation mirrors the server logic exactly so that when sync
   * replays the sale with real costs, the same formula produces the
   * correct weighted average.
   */
  private computeWeightedUnitCost(consumedLots: ConsumedLot[]): Prisma.Decimal {
    const totalQuantity = consumedLots.reduce((sum, cl) => sum + cl.quantity, 0);
    if (totalQuantity === 0) return new Prisma.Decimal(0);

    const totalCost = consumedLots.reduce(
      (sum, cl) => sum.plus(cl.unitCostAtSale.times(cl.quantity)),
      new Prisma.Decimal(0),
    );
    return totalCost.dividedBy(totalQuantity);
  }

  /**
   * Hash a string payload using SHA-256, returning a lowercase hex digest.
   *
   * Uses the Web Crypto API (SubtleCrypto) which is available in modern
   * browsers and Tauri webviews.  No Node.js dependency required.
   */
  private async computePayloadHash(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Build and insert a SyncQueue row for a confirmed sale.
   *
   * The payload contains everything the server-side `create` and `confirm`
   * endpoints need to replay this sale for real: the create input (items,
   * quantities, prices), the confirm input (payments), and metadata about
   * the local operation (timestamps, workstation, local number).
   *
   * This runs inside the same transaction as the sale confirmation, so
   * a confirmed sale always has a corresponding sync queue entry.
   */
  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    sale: {
      id: string;
      localNumber: bigint;
      startedAt: Date;
      cashShiftId: string;
      clientId: string | null;
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        discountPercentage: Prisma.Decimal;
        discountReason: string | null;
      }>;
    },
    input: ConfirmSaleInput,
    session: { userId: string; workstationId: string },
    confirmedAt: Date,
  ): Promise<void> {
    // Build the structured payload — the exact shape the server-side replay
    // processor will deserialise for SALE_CONFIRMATION operations.
    const payloadObj = {
      createInput: {
        saleType: 'FREE_SALE',
        cashShiftId: sale.cashShiftId,
        clientId: sale.clientId,
        items: sale.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          discountPercentage: Number(item.discountPercentage.toString()),
          discountReason: item.discountReason,
        })),
        prescriptionNumber: null,
      },
      confirmInput: {
        payments: input.payments.map((p) => ({
          paymentMethodId: p.paymentMethodId,
          amount: p.amount,
          transactionReference: p.transactionReference ?? null,
          authorizationCode: p.authorizationCode ?? null,
          cardBrand: p.cardBrand ?? null,
          cardLastFour: p.cardLastFour ?? null,
          batchNumber: p.batchNumber ?? null,
          processorResponseCode: p.processorResponseCode ?? null,
        })),
      },
      metadata: {
        localSaleId: sale.id,
        localNumber: Number(sale.localNumber),
        workstationId: session.workstationId,
        sourceWorkstationId: session.workstationId,
        startedAt: sale.startedAt.toISOString(),
        confirmedAt: confirmedAt.toISOString(),
      },
    };

    const payload = JSON.stringify(payloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadSize = payloadBytes.length;
    const payloadHash = await this.computePayloadHash(payload);
    const operationUuid = globalThis.crypto.randomUUID();

    // Get the next sequential clientSequence per workstation
    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid,
        operationType: 'SALE_CONFIRMATION',
        payload,
        payloadHash,
        payloadSize,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: session.workstationId,
        sourceCreatedAt: confirmedAt,
        clientSequence,
      },
    });
  }
}
