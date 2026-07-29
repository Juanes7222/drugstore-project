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
import { PrismaClient, Prisma, SaleOperationalState, SaleType, ShiftState, PaymentMethodCategory } from '@pharmacy/database/local';
import { dbWriteLock } from '../../infrastructure/write-lock';
import { notifyPendingEntry } from '../sync/sync-queue-notifier';
import type { AuthService } from '../auth/auth.service';
import type { InventoryLotsService, ConsumedLot } from '../inventory-lots/inventory-lots.service';
import type { InvoiceService } from '../fiscal/invoice.service';
import type { PrintRouter } from '../printing/print-router';
import { PrintJobType, PrintPayloadType } from '../printing/printing-types';
import { writePrintPayload } from '../printing/print-payload-writer';
import { RoleType } from '@pharmacy/shared-types';
import type { LocalAuditWriter } from '../audit/local-audit-writer.service';
import { LocalAuditEvent } from '../audit/local-audit-writer.service';
import {
  GENERIC_CLIENT_UUID,
  GENERIC_CLIENT_IDENTIFICATION_TYPE,
  GENERIC_CLIENT_IDENTIFICATION_NUMBER,
  GENERIC_CLIENT_NAME,
} from '../../domain/clients/constants/clients.constants';
import {
  SaleNotInProgressException,
  PrescriptionRequiredNotSupportedException,
  PaymentAmountMismatchException,
  ChangeRequiresCashPaymentException,
  SaleNotFoundException,
} from './exceptions';
import {
  validateItemPricing,
  validateSalePricing,
} from './sales-pricing-validator';
import {
  getDiscountLimits,
  getSalesConfig,
} from '../configuration/local-config.store';

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

/**
 * Result returned by `SalesPosService.confirm()`.
 *
 * Extends the confirmed Sale record with metadata about post-confirm
 * operations that ran outside the main transaction.
 */
export interface ConfirmResult {
  /** The confirmed Sale record (all Prisma fields). */
  [key: string]: unknown;
  /** `true` when the fiscal invoice was generated successfully. */
  invoiceGenerated: boolean;
  /** Human-readable failure reason when invoice generation failed. */
  invoiceError?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSalesPosService = (
  prisma: PrismaClient,
  auth: AuthService,
  inventoryLots: InventoryLotsService,
  invoiceService?: InvoiceService,
  printRouter?: PrintRouter,
  auditWriter?: LocalAuditWriter,
): SalesPosService => {
  return new SalesPosService(prisma, auth, inventoryLots, invoiceService, printRouter, auditWriter);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SalesPosService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
    private readonly inventoryLots: InventoryLotsService,
    private readonly invoiceService?: InvoiceService,
    private readonly printRouter?: PrintRouter,
    private readonly auditWriter?: LocalAuditWriter,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Resolve a frontend payment-method type string to the DB PaymentMethod UUID.
   *
   * Frontend uses lowercase types ("cash", "card", "transfer", "nequi").
   * The DB stores PaymentMethod rows with a `category` enum. This method
   * maps the frontend type to a DB category and returns the first matching
   * method's ID.
   *
   * @throws Error if no matching payment method is found in the local DB.
   */
  async resolvePaymentMethodId(type: string): Promise<string> {
    const categoryMap: Record<string, PaymentMethodCategory> = {
      cash: PaymentMethodCategory.CASH,
      card: PaymentMethodCategory.CREDIT_CARD,
      transfer: PaymentMethodCategory.BANK_TRANSFER,
      nequi: PaymentMethodCategory.DIGITAL_WALLET,
    };

    const category = categoryMap[type.toLowerCase()];
    if (!category) {
      throw new Error(`Unknown payment method type "${type}".`);
    }

    const method = await this.prisma.paymentMethod.findFirst({
      where: { category },
      select: { id: true },
    });

    if (!method) {
      throw new Error(
        `No PaymentMethod found in DB for category "${category}". ` +
        'Run payment-method sync to seed the local catalog.',
      );
    }

    return method.id;
  }

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

      const resolvedClientId = input.clientId ?? GENERIC_CLIENT_UUID;
      // Defensive fallback for the generic client — getClientSnapshot normally
      // finds it because seedGenericClientIfEmpty runs on startup.
      const clientData = await this.getClientSnapshot(tx, resolvedClientId)
        ?? this.buildInlineGenericClientSnapshot();

      const clientDiscountPct = clientData?.classification?.discountPercentage
        ? new Prisma.Decimal(clientData.classification.discountPercentage.toString())
        : new Prisma.Decimal(0);

      const saleItems: BuiltSaleItem[] = await Promise.all(
        input.items.map((item) =>
          this.buildSaleItemFromRequest(
            tx,
            item,
            clientDiscountPct,
            session.role,
          ),
        ),
      );

      const totals: SaleTotals = this.calculateSaleTotals(
        saleItems as unknown as SaleItemTotals[],
      );

      // Sale-level global discount cap.  Per-item limits are enforced
      // inside `buildSaleItemFromRequest`; this final check catches the
      // case where several small per-item discounts add up to a sale
      // total that exceeds the role's `globalMaxPercent`.
      validateSalePricing({
        role: session.role,
        totalDiscount: totals.totalDiscount,
        subtotal: totals.subtotal,
        discountLimits: getDiscountLimits(),
      });

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
  /**
   * Maximum number of retry attempts when a Prisma transaction times out
   * due to contention (e.g. sync scheduler using the single PGlite connection).
   * Each retry adds 500 ms exponential backoff.
   */
  private static readonly MAX_CONFIRM_RETRIES = 3;

  async confirm(saleId: string, input: ConfirmSaleInput): Promise<unknown> {
    // Return type is intentionally `unknown` for backward compatibility.
    // Use `ConfirmResult` type assertion on the caller side to access
    // `invoiceGenerated` and `invoiceError` fields.
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    // Acquire the PGlite write lock so no sync step runs concurrently.
    // This guarantees the $transaction never contends for the single
    // connection — sale confirm completes in real time.
    await dbWriteLock.acquire();
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= SalesPosService.MAX_CONFIRM_RETRIES; attempt++) {
        try {
          return await this.prisma.$transaction(async (tx) => {
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
      // Use Decimal arithmetic throughout to avoid IEEE 754 drift from
      // cents→pesos division (e.g. 12495 / 100 = 124.94999… in JS).
      // Round the sum to 2 decimal places so any floating-point artifact is
      // eliminated before comparing with the DB-stored total.
      const totalPaidDecimal = input.payments.reduce(
        (sum, p) => sum.plus(p.amount),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      // Round DB-stored total too — sales created before the cents→pesos fix
      // (old JS division) stored imprecise values like 124.949999… instead of
      // exactly 124.95. Rounding both sides eliminates the ghost difference.
      const saleTotalDecimal = sale.totalAmount.toDecimalPlaces(
        2, Prisma.Decimal.ROUND_HALF_UP,
      );
      const saleTotalNumber = Number(saleTotalDecimal.toString());

      const changeAmount = totalPaidDecimal.minus(saleTotalDecimal).toDecimalPlaces(
        2, Prisma.Decimal.ROUND_HALF_UP,
      );

      // Ghost-difference guard: any gap < 1 cent (₡0.01) is IEEE 754 drift,
      // not a real discrepancy.  COP has no fractional centavos — the
      // frontend always works in whole cents — so any meaningful difference
      // is ≥ 1¢.  This covers both the overpayment and underpayment sides
      // without requiring the DB-stored total to match the frontend's exact
      // rounding (frontend uses Math.round for tax, DB uses Decimal).
      const ONE_CENT = new Prisma.Decimal('0.01');
      if (changeAmount.abs().lessThan(ONE_CENT)) {
        // treat as exact match — no change, proceed
      } else if (changeAmount.lessThan(0)) {
        throw new PaymentAmountMismatchException(
          saleTotalNumber,
          totalPaidDecimal.toNumber(),
        );
      } else {
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
        }, tx); // Pass tx to avoid nested $transaction on single-connection PGlite

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
    }).then(async (result) => {
      // Transaction committed — trigger immediate push instead of waiting
      // for the 5-minute scheduler cycle.
      notifyPendingEntry();

      // 7. Generate invoice (fiscal document) after the sale confirms.
      //    This runs outside the main transaction so it doesn't block the
      //    confirm with fiscal computation. If invoice generation fails, the
      //    sale is still confirmed — the failure is logged.
      let invoiceGenerated = false;
      let invoiceError: string | undefined;
      if (this.invoiceService) {
        try {
          await this.invoiceService.generateInvoiceForSale(saleId);
          invoiceGenerated = true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          invoiceError = message;
          console.error(
            `[SalesPosService] Invoice generation FAILED for sale ${saleId}. ` +
            `Sale is confirmed but no fiscal document was created. Reason: ${message}`,
          );
          if (err instanceof Error && err.stack) {
            console.error(`[SalesPosService] Stack: ${err.stack}`);
          }
        }
      } else {
        console.warn(
          `[SalesPosService] No invoiceService configured for workstation. ` +
          `Sale ${saleId} confirmed without fiscal document.`,
        );
      }

      // 8. Enqueue the receipt print job (fire-and-forget from the caller's
      //    perspective). The print router handles the routing, fallback, and
      //    queueing. If the router is not configured, printing is skipped.
      if (this.printRouter) {
        try {
          const resultData = result as { id: string; localNumber: bigint };
          // The receipt payload is generated as HTML for thermal printers.
          // At this point the invoice may have been generated above with a
          // fiscal PDF — we print the SALE_RECEIPT version.
          const receiptHtml = (await import('../fiscal/receipt-generator'))
            .generateReceiptHtml({
              id: saleId,
              invoiceNumber: `V${String(resultData.localNumber)}`,
              contingencyNumber: null,
              invoiceType: 'SALE_RECEIPT',
              status: 'TRANSMITTED_AUTHORIZED',
              cufeProvisional: '',
              cufeOfficial: null,
              issuedAt: new Date(),
              fullData: null,
            });

          // Write receipt HTML to a temp file for the print router
          const receiptPath = await writePrintPayload(
            `receipt-${saleId}.html`,
            receiptHtml,
          );

          await this.printRouter.print(PrintJobType.SALE_RECEIPT, {
            payloadPath: receiptPath,
            payloadType: PrintPayloadType.HTML,
            saleId,
          });

          // 8b. If the invoice was generated, also enqueue the
          //     ELECTRONIC_INVOICE print job (for laser/inkjet printers).
          //     Fire-and-forget from the caller's perspective.
          if (invoiceGenerated) {
            try {
              const invoicePath = await writePrintPayload(
                `invoice-${saleId}.html`,
                receiptHtml, // Reuse the receipt HTML; the actual fiscal PDF
                              // is generated server-side and available later
              );

              await this.printRouter.print(PrintJobType.ELECTRONIC_INVOICE, {
                payloadPath: invoicePath,
                payloadType: PrintPayloadType.HTML,
                saleId,
              });
            } catch (err) {
              console.error(
                `[SalesPosService] Electronic invoice print routing failed for sale ${saleId}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
        } catch (err) {
          console.error(
            `[SalesPosService] Print routing failed for sale ${saleId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Audit trail — sale confirmed
      const confirmedSale = result as { id: string; localNumber?: bigint; totalAmount?: Prisma.Decimal };
      this.auditWriter?.write(LocalAuditEvent.SALE_CONFIRMED, {
        category: 'sale',
        entityType: 'Sale',
        entityId: saleId,
        userId: session.userId,
        userRole: session.role,
        workstationId: session.workstationId,
        details: {
          localNumber: confirmedSale.localNumber?.toString(),
          totalAmount: confirmedSale.totalAmount?.toString(),
          paymentCount: input.payments.length,
          invoiceGenerated,
          invoiceError,
        },
      });

      return {
        ...(result as Record<string, unknown>),
        invoiceGenerated,
        ...(invoiceError ? { invoiceError } : {}),
      } as ConfirmResult;
    });
      } catch (error: unknown) {
        // PrismaClientKnownRequestError with code P2028 means the
        // transaction could not start because the single PGlite connection
        // was busy (e.g. sync scheduler running).  Retry with backoff.
        const isTimeout =
          error instanceof Error &&
          (error as { code?: string }).code === 'P2028' &&
          error.message.includes('Unable to start a transaction');

        if (isTimeout && attempt < SalesPosService.MAX_CONFIRM_RETRIES) {
          const delay = attempt * 500; // 500 ms, 1000 ms, 1500 ms
          console.warn(
            `[SalesPosService] Transaction timeout on confirm attempt ${attempt}/${SalesPosService.MAX_CONFIRM_RETRIES}. ` +
            `Retrying after ${delay} ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          lastError = error;
          continue;
        }

        // Non-timeout error or final attempt exhausted — propagate.
        throw error;
      }
    }

    // All retries exhausted — throw the last captured error.
    throw lastError ?? new Error('Sale confirm failed after retries');
      } finally {
        dbWriteLock.release();
      }
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
   * Build an inline snapshot of the generic client for the defensive case
   * where the DB lookup fails (should not happen — seedGenericClientIfEmpty
   * runs on startup). The `as any` on identificationType is safe here since
   * the value ('NIT') matches the Prisma enum label exactly.
   */
  private buildInlineGenericClientSnapshot() {
    return {
      id: GENERIC_CLIENT_UUID,
      identificationType: GENERIC_CLIENT_IDENTIFICATION_TYPE as any,
      identificationNumber: GENERIC_CLIENT_IDENTIFICATION_NUMBER,
      fullName: GENERIC_CLIENT_NAME,
      classification: null,
    };
  }

  /**
   * Resolve a single sale item from the request: validate product, read
   * price and tax from the local catalog cache, compute discount and tax
   * amounts.
   *
   * Mirrors the server's `buildSaleItemFromRequest` exactly, but returns
   * a plain object instead of a Prisma input type, since there is no
   * NestJS dependency.
   *
   * After resolving the price and discount, runs the per-item pricing
   * rules from `sales-pricing-validator.ts` so role-based discount
   * limits, price-override permissions, and the cost floor are checked
   * here — before any state is written.
   */
  private async buildSaleItemFromRequest(
    tx: Prisma.TransactionClient,
    item: CreateSaleItemInput,
    clientDiscountPercentage: Prisma.Decimal,
    role: RoleType | string,
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
        costHistories: {
          where: { effectiveTo: null },
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
          select: { cost: true },
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
    const catalogUnitPrice = product.priceHistories[0]?.price
      ?? new Prisma.Decimal(0);
    const unitPrice = item.unitPrice ?? catalogUnitPrice;

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

    // Per-item pricing rules: discount cap, price-override permission,
    // and the universal cost floor.  Read the current config snapshot
    // inside the transaction so the limits are consistent with what
    // the store had at the moment the user clicked "create".
    validateItemPricing({
      role,
      productId: item.productId,
      requestedUnitPrice: item.unitPrice,
      catalogUnitPrice,
      discountPercentage:
        item.discountPercentage !== undefined
          ? Number(discountPercentage.toString())
          : undefined,
      productCost: product.costHistories[0]?.cost ?? null,
      discountLimits: getDiscountLimits(),
      salesConfig: getSalesConfig(),
    });

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
   * The payload contains everything the server-side `handleSaleConfirmation`
   * needs to replay this sale: the userId, the createSaleDto (items,
   * quantities, prices), the confirmSaleDto (payments), and metadata about
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
      subtotal: Prisma.Decimal;
      totalDiscount: Prisma.Decimal;
      totalTax: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
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
    // Resolve local product IDs to server product IDs so the
    // server-side dispatcher can find each product when replaying
    // this sale.  The POS stores the local UUID in SaleItem.productId;
    // the server needs the server-assigned id (Product.serverId) to
    // look up the product.  Without this remap, every SALE_CONFIRMATION
    // for an offline-created product fails with ProductNotFoundException
    // because the server generated a different UUID during PRODUCT_CREATION.
    const localIds = [...new Set(sale.items.map((i) => i.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: localIds } },
      select: { id: true, serverId: true },
    });
    const serverIdByLocal = new Map<string, string>();
    for (const p of products) {
      if (p.serverId) serverIdByLocal.set(p.id, p.serverId);
    }

    // Build the structured payload matching the server-side dispatcher's
    // expectations: userId, createSaleDto, confirmSaleDto. Metadata is
    // included for local audit but is not consumed server-side.
    const payloadObj = {
      userId: session.userId,
      createSaleDto: {
        saleType: 'FREE_SALE',
        cashShiftId: sale.cashShiftId,
        clientId: sale.clientId ?? GENERIC_CLIENT_UUID,
        items: sale.items.map((item) => ({
          productId: serverIdByLocal.get(item.productId) ?? item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          discount: item.discountPercentage.toString(),
          discountReason: item.discountReason,
        })),
        prescriptionNumber: null,
        // Snapshotted sale-header totals. The server uses these as the
        // authoritative figures (CreateSaleSchema.subtotal/totalDiscount/
        // totalTax/totalAmount) when all four are present, so a drifted
        // catalog between sale time and sync time can't cause
        // `Total payments do not match total sale amount` failures.
        subtotal: sale.subtotal.toString(),
        totalDiscount: sale.totalDiscount.toString(),
        totalTax: sale.totalTax.toString(),
        totalAmount: sale.totalAmount.toString(),
      },
      confirmSaleDto: {
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
