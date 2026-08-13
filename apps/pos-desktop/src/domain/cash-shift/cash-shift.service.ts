/**
 * Local cash-shift service for the POS desktop app.
 *
 * Ported from the server-side CashShiftService in apps/server, but as a
 * plain class (no NestJS decorators) constructed with the local Prisma
 * client from the PGlite database singleton.
 *
 * Business rules are unchanged from the server:
 * - No opening a shift when one is already open for the current session's workstation
 * - `difference` is always computed server-side (here, computed by this local service)
 * - `denominationsBreakdown` is rejected for a non-cash payment method
 * - Closing requires a `CLOSING` count already registered for every payment method with activity
 *
 * Every public method calls `requireRole` at its top, matching the original
 * controller's `@Roles()` decorators.
 *
 * ## Audit trail
 * AuditLog is a server-only model absent from the local Prisma schema. These
 * methods do NOT write an audit entry locally. The audit trail for a locally-
 * created shift is produced when `sync` later replays this operation against
 * the real server-side service, which carries its own `@Auditable` decorator.
 * This is expected behavior, not a gap this task fills.
 */
import { PrismaClient } from '@pharmacy/database/local';
import { RoleType } from '@pharmacy/shared-types';
// Uses globalThis.crypto.randomUUID() from the Web Crypto API (available
// in modern browsers and Tauri webviews). No Node.js import needed.
import { Prisma, InvoiceAdjustmentType, SaleOperationalState } from '@pharmacy/database/local';
import {
  ShiftAlreadyOpenException,
  ShiftNotOpenException,
  MissingClosingCashCountsException,
  InvalidCashCountForNonCashMethodException,
  PaymentMethodNotFoundException,
} from './exceptions';
import type { AuthService } from '../auth/auth.service';
import { useLocalSessionStore } from '../auth/local-session.store';
import { useCashShiftStore } from './cash-shift.store';
import { getSalesConfig } from '../configuration/local-config.store';
import { createBackupService, BackupFailedException } from '../backup';
import type { LocalAdjustmentService } from '../fiscal/local-adjustment.service';
import type { OperationalInvoiceView } from '../fiscal/local-adjustment.types';
import type { PrintRouter } from '../printing/print-router';
import { PrintJobType, PrintPayloadType } from '../printing/printing-types';
import { writePrintPayload } from '../printing/print-payload-writer';
import { generateShiftCloseHtml } from './shift-close-html';
import type { LocalAuditWriter } from '../audit/local-audit-writer.service';
import { LocalAuditEvent } from '../audit/local-audit-writer.service';
import { dbWriteLock } from '../../infrastructure/write-lock';

/**
 * How many `resolveOperationalView` calls run per batch while layering
 * payment adjustments onto the shift totals.
 *
 * PGlite has a single connection, so `Promise.all` over a chunk only queues
 * queries — there is no parallelism to gain from large batches. Small slices
 * keep each batch's in-flight state and memory bounded without any
 * throughput cost.
 */
const RESOLVE_OPERATIONAL_VIEW_CHUNK_SIZE = 4;

/** Input for `registerCashCount` (and its internal variant). */
type RegisterCashCountInput = {
  countType: 'PARTIAL' | 'CLOSING';
  paymentMethodId: string;
  expectedAmount: Prisma.Decimal;
  declaredAmount: Prisma.Decimal;
  denominationsBreakdown?: Record<string, number>;
};

/** Session claims needed by the internal count/close variants. */
type CashShiftSession = { userId: string; workstationId: string; role: string };

export const createCashShiftService = (
  prisma: PrismaClient,
  authService: AuthService,
  adjustmentService?: LocalAdjustmentService,
  printRouter?: PrintRouter,
  auditWriter?: LocalAuditWriter,
): CashShiftService => {
  return new CashShiftService(prisma, authService, adjustmentService, printRouter, auditWriter);
};

export class CashShiftService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
    private readonly adjustmentService?: LocalAdjustmentService,
    private readonly printRouter?: PrintRouter,
    private readonly auditWriter?: LocalAuditWriter,
  ) {}

  /**
   * Open a cash shift for the current session's workstation.
   *
   * Requires CASHIER or ADMIN role.
   * Throws `ShiftAlreadyOpenException` if there is already an open shift
   * for this workstation.
   */
  async openShift(dto: {
    openingBalance: Prisma.Decimal;
    openingNotes?: string;
  }): Promise<CashShiftRecord> {
    // Same write-lock as the other CashShift write operations: openShift
    // writes a CashShift row and must not interleave with a background sync
    // step on the single PGlite connection. Nothing inside re-acquires the
    // lock (no nesting). Foreground priority: a user action never waits
    // behind queued background sync steps.
    await dbWriteLock.acquire('foreground');
    try {
      const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

      await this.assertNoOpenShiftExists(session.workstationId);

      const shift = await this.prisma.cashShift.create({
        data: {
          id: this.generateId(),
          workstationId: session.workstationId,
          userId: session.userId,
          openingBalance: dto.openingBalance,
          openingNotes: dto.openingNotes ?? null,
          openedAt: new Date(),
          state: 'OPEN',
        },
      });

      // Audit trail
      this.auditWriter?.write(LocalAuditEvent.CASH_SHIFT_OPENED, {
        category: 'cash_shift',
        entityType: 'CashShift',
        entityId: shift.id,
        userId: session.userId,
        userRole: session.role,
        workstationId: session.workstationId,
        details: {
          openingBalance: dto.openingBalance.toString(),
          openingNotes: dto.openingNotes ?? null,
        },
      });

      return shift;
    } finally {
      dbWriteLock.release();
    }
  }

  /**
   * Register a cash count (partial or closing) against a shift.
   *
   * Requires CASHIER or ADMIN role.
   * Throws `ShiftNotOpenException` if the shift is not open.
   * Throws `PaymentMethodNotFoundException` if the payment method does not exist.
   * Throws `InvalidCashCountForNonCashMethodException` if denominationsBreakdown
   * is provided for a non-cash payment method.
   *
   * @param shiftId - The ID of the open cash shift
   * @param dto - countType, paymentMethodId, expectedAmount, declaredAmount, and optional denominationsBreakdown
   */
  async registerCashCount(
    shiftId: string,
    dto: RegisterCashCountInput,
  ): Promise<unknown> {
    // Same write-lock as the close flow: a count is a write to ShiftCashCount
    // that must not interleave with a background sync step on the single
    // PGlite connection. The internal variant does not re-acquire (no
    // nesting). Foreground priority: a user action never waits behind queued
    // background sync steps.
    await dbWriteLock.acquire('foreground');
    try {
      const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

      await this.getOpenShift(shiftId);

      return this.registerCashCountInternal(shiftId, dto, session);
    } finally {
      dbWriteLock.release();
    }
  }

  /**
   * Register a cash count assuming the shift is open and the role was
   * already checked by the caller. Used by `registerCashCount` (which
   * validates first) and by `closeWithCounts` to avoid re-reading the
   * shift for every CLOSING count.
   *
   * @param paymentMethod  Already-loaded payment method. When provided (the
   *   caller — `closeWithCounts` — validated existence and loaded it for its
   *   `methodMap`), the per-count `findUnique` is skipped entirely.
   */
  private async registerCashCountInternal(
    shiftId: string,
    dto: RegisterCashCountInput,
    session: CashShiftSession,
    paymentMethod?: { isCash: boolean },
  ): Promise<unknown> {
    const loadedPaymentMethod =
      paymentMethod ??
      (await this.prisma.paymentMethod.findUnique({
        where: { id: dto.paymentMethodId },
      }));

    if (!loadedPaymentMethod) {
      throw new PaymentMethodNotFoundException(dto.paymentMethodId);
    }

    if (dto.denominationsBreakdown && !loadedPaymentMethod.isCash) {
      throw new InvalidCashCountForNonCashMethodException();
    }

    const difference = dto.declaredAmount.minus(dto.expectedAmount);

    const count = await this.prisma.shiftCashCount.create({
      data: {
        id: this.generateId(),
        cashShiftId: shiftId,
        countType: dto.countType,
        paymentMethodId: dto.paymentMethodId,
        paymentMethodIsCash: loadedPaymentMethod.isCash,
        expectedAmount: dto.expectedAmount,
        declaredAmount: dto.declaredAmount,
        difference,
        denominationsBreakdown: loadedPaymentMethod.isCash
          ? (dto.denominationsBreakdown ?? Prisma.DbNull)
          : Prisma.DbNull,
        createdById: session.userId,
        createdAt: new Date(),
      },
    });

    // Audit trail for partial counts (closing counts are audited inside closeShift)
    if (dto.countType === 'PARTIAL') {
      this.auditWriter?.write(LocalAuditEvent.CASH_COUNT_PARTIAL, {
        category: 'cash_shift',
        entityType: 'ShiftCashCount',
        entityId: count.id,
        userId: session.userId,
        userRole: session.role,
        details: {
          shiftId,
          expectedAmount: dto.expectedAmount.toString(),
          declaredAmount: dto.declaredAmount.toString(),
          difference: difference.toString(),
          paymentMethodId: dto.paymentMethodId,
          isCash: loadedPaymentMethod.isCash,
        },
      });
    }

    return count;
  }

  /**
   * Close a cash shift.
   *
   * Requires CASHIER or ADMIN role.
   * Throws `ShiftNotOpenException` if the shift is not open.
   * Throws `MissingClosingCashCountsException` if any active payment method
   * does not have a CLOSING count registered.
   */
  async closeShift(
    shiftId: string,
    dto: { closingNotes?: string },
    /** Precomputed expected totals — reuse avoids a second operational-view
     *  resolution when the caller (closeWithCounts) already computed them. */
    expectedTotals?: Map<string, Prisma.Decimal>,
  ): Promise<unknown> {
    // Serialize the whole close (counts + final update + backup) under the
    // PGlite write lock, exactly like sale confirm. This both shields the
    // flow from a background sync step holding the single connection and
    // turns a double submission (wizard double-click) into a clean second
    // `ShiftNotOpenException` instead of duplicated CLOSING counts.
    //
    // The mandatory backup (a full DB dump) is the long pole of the critical
    // section, so the background is paused before acquiring: sync steps that
    // arrive mid-close skip their work instead of queueing behind the dump,
    // and the foreground acquire jumps the queue so the close only ever
    // waits for a single in-flight step.
    dbWriteLock.pauseBackground();
    try {
      await dbWriteLock.acquire('foreground');
      try {
        const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

        await this.getOpenShift(shiftId);

        return this.closeShiftInternal(shiftId, dto, expectedTotals, session);
      } finally {
        dbWriteLock.release();
      }
    } finally {
      dbWriteLock.resumeBackground();
    }
  }

  /**
   * Close a cash shift assuming the shift is open and the role was already
   * checked by the caller. `closeShift` validates first; `closeWithCounts`
   * calls this directly after its own single open-shift check.
   */
  private async closeShiftInternal(
    shiftId: string,
    dto: { closingNotes?: string },
    expectedTotals: Map<string, Prisma.Decimal> | undefined,
    session: CashShiftSession,
  ): Promise<unknown> {
    const closingCounts = await this.prisma.shiftCashCount.findMany({
      where: {
        cashShiftId: shiftId,
        countType: 'CLOSING',
      },
      include: {
        paymentMethod: {
          select: { name: true },
        },
      },
    });

    const activePaymentMethods = await this.getActivePaymentMethods(
      shiftId,
      expectedTotals,
    );
    const missingMethods = this.findMissingClosingCounts(
      activePaymentMethods,
      closingCounts,
    );

    if (missingMethods.length > 0) {
      throw new MissingClosingCashCountsException(missingMethods);
    }

    const { expectedAmount, actualAmount } =
      this.computeClosingTotals(closingCounts);

    const closingDifference = actualAmount.minus(expectedAmount);

    // A backup is mandatory before a shift can be closed. If the backup fails,
    // the shift remains open and the cashier is told to contact a manager.
    const [pendingCount, failedCount, permanentFailureCount, discardedCount, maxSeqRow] =
      await Promise.all([
        this.prisma.syncQueue.count({ where: { status: 'PENDING' } }),
        this.prisma.syncQueue.count({ where: { status: 'FAILED' } }),
        this.prisma.syncQueue.count({ where: { status: 'PERMANENT_FAILURE' } }),
        this.prisma.syncQueue.count({ where: { status: 'DISCARDED' } }),
        this.prisma.syncQueue.aggregate({ _max: { clientSequence: true } }),
      ]);

    const backupService = createBackupService();
    try {
      await backupService.createBackup({
        reason: 'SHIFT_CLOSE',
        workstationId: session.workstationId,
        dbSchemaVersion: 1,
        pendingCount,
        failedCount,
        permanentFailureCount,
        discardedCount,
        maxClientSequence: Number(maxSeqRow._max.clientSequence ?? 0n),
      });
    } catch (err) {
      if (err instanceof BackupFailedException) {
        throw err;
      }
      throw new BackupFailedException(
        err instanceof Error ? err.message : 'Shift-close backup failed',
      );
    }

    const closedShift = await this.prisma.cashShift
      .update({
        where: { id: shiftId },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          closedByUserId: session.userId,
          expectedClosingAmount: expectedAmount,
          actualClosingAmount: actualAmount,
          closingDifference,
          closingNotes: dto.closingNotes ?? null,
        },
        include: {
          cashCounts: true,
        },
      });

    // Audit trail
    this.auditWriter?.write(LocalAuditEvent.CASH_SHIFT_CLOSED, {
      category: 'cash_shift',
      entityType: 'CashShift',
      entityId: shiftId,
      userId: session.userId,
      userRole: session.role,
      workstationId: session.workstationId,
      details: {
        expectedClosingAmount: expectedAmount.toString(),
        actualClosingAmount: actualAmount.toString(),
        closingDifference: closingDifference.toString(),
        closingNotes: dto.closingNotes ?? null,
        paymentMethodCount: closingCounts.length,
        pendingSyncCount: pendingCount,
        failedSyncCount: failedCount,
        permanentFailureSyncCount: permanentFailureCount,
        discardedSyncCount: discardedCount,
      },
    });

    return this.handlePostClose(closedShift, session, closingCounts, shiftId, dto.closingNotes);
  }

  // ---------------------------------------------------------------------------
  // Operational-view-aware methods
  // ---------------------------------------------------------------------------

  /**
   * Compute expected totals per payment method for a shift.
   *
   * Base is always direct `SalePayment` sum (works regardless of invoice
   * records). When `adjustmentService` is available, additionally merges
   * operational-view adjustments (PAYMENT_METHOD_CHANGE, etc.) on top.
   *
   * @param shiftId  The cash shift to compute totals for
   * @param baseTotals  Precomputed fiscal totals (direct SalePayment sums).
   *   When provided, the GROUP BY aggregation is skipped — used by
   *   `getShiftFiscalComparison` so the fiscal map is computed once and
   *   reused for both the fiscal column and the operational overlay.
   * @returns A map of paymentMethodId → total expected amount
   */
  async computeExpectedTotalsByPaymentMethod(
    shiftId: string,
    baseTotals?: Map<string, Prisma.Decimal>,
    options?: { includeCreditPayments?: boolean },
  ): Promise<Map<string, Prisma.Decimal>> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    // Base: direct SalePayment sum — always works, no invoice dependency.
    // Reuse the caller-provided fiscal map when available (drift comparison)
    // so the aggregation runs once instead of twice.
    const baseTotalsLocal =
      baseTotals ?? (await this.getDirectPaymentTotals(shiftId));

    // Credit payments (abonos) received during the shift move real money
    // through the drawer, so every expected-total computation for the close
    // wizard and the active-methods check adds them per payment method.
    // The drift comparison passes a base that already includes them and
    // opts out here to avoid double counting.
    if (options?.includeCreditPayments === false) {
      return this.adjustmentService
        ? await this.layerAdjustments(baseTotalsLocal, shiftId)
        : baseTotalsLocal;
    }

    const withCreditPayments = await this.mergeCreditPaymentTotals(
      shiftId,
      baseTotalsLocal,
    );

    if (!this.adjustmentService) {
      return withCreditPayments;
    }

    return this.layerAdjustments(withCreditPayments, shiftId);
  }

  /**
   * Sum of credit payments (abonos) per payment method for a shift.
   *
   * Abonos are recorded against the open cash shift at the moment they are
   * collected (`ClientCreditPayment.cashShiftId`), so the expected cash drawer
   * amount for the close must include them or the cashier's count would never
   * reconcile.
   */
  private async getCreditPaymentTotals(
    shiftId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    // Annulled abonos (admin reversals) never entered the drawer in net
    // terms, so they are excluded from the expected totals.
    const groups = await this.prisma.clientCreditPayment.groupBy({
      by: ['paymentMethodId'],
      where: { cashShiftId: shiftId, annulledAt: null },
      _sum: { amount: true },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const group of groups) {
      totals.set(
        group.paymentMethodId,
        group._sum.amount ?? new Prisma.Decimal(0),
      );
    }
    return totals;
  }

  /**
   * Return a new totals map with per-method credit-payment totals added on
   * top, so every expected-total consumer sees abonos without re-implementing
   * the merge and without mutating the caller's map.
   *
   * @param creditTotals  Precomputed abono totals — when provided, the GROUP BY
   *   is skipped (callers that also need the breakdown for the wizard UI pass
   *   the same map to avoid a duplicate aggregation).
   */
  private async mergeCreditPaymentTotals(
    shiftId: string,
    totals: Map<string, Prisma.Decimal>,
    creditTotals?: Map<string, Prisma.Decimal>,
  ): Promise<Map<string, Prisma.Decimal>> {
    const credit =
      creditTotals ?? (await this.getCreditPaymentTotals(shiftId));
    const merged = new Map(totals);
    for (const [paymentMethodId, amount] of credit) {
      const current = merged.get(paymentMethodId) ?? new Prisma.Decimal(0);
      merged.set(paymentMethodId, current.plus(amount));
    }
    return merged;
  }

  /**
   * Layer non-reversed payment adjustments (PAYMENT_METHOD_CHANGE, etc.) on
   * top of a base totals map, resolving each affected invoice's operational
   * view in small bounded batches.
   */
  private async layerAdjustments(
    baseTotals: Map<string, Prisma.Decimal>,
    shiftId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const adjusted = new Map(baseTotals);

    // Load active payment methods once so we can resolve the `category` enum
    // values that the adjustment-creation modal mistakenly stores in the
    // `paymentMethodId` field of `InvoiceLocalAdjustment.newValue` back to
    // real `PaymentMethod.id` UUIDs. Without this normalization, the
    // computed totals would be keyed under strings like "BANK_TRANSFER" and
    // never match anything when `getActivePaymentMethodsWithNames` looks up
    // the method by id.
    const paymentMethodResolver = await this.buildPaymentMethodResolver();

    // Layer operational adjustments on top of base totals.
    // Primary path: resolveOperationalView (handles full adjustment chain
    // including reversals). If it throws (e.g. malformed invoice JSON),
    // logs the error and falls back to querying InvoiceLocalAdjustment
    // directly.
    const sales = await this.prisma.sale.findMany({
      where: {
        cashShiftId: shiftId,
        operationalState: 'CONFIRMED',
      },
      select: { id: true },
    });

    const saleIds = sales.map((s) => s.id);
    if (saleIds.length === 0) return adjusted;

    const invoices = await this.prisma.invoice.findMany({
      where: { saleId: { in: saleIds } },
      select: { id: true },
    });

    if (invoices.length === 0) return adjusted;

    // Only invoices that carry a non-reversed payment-affecting adjustment
    // need the full operational-view resolution. For every other invoice
    // fiscal payments equal operational payments, so the delta is zero —
    // resolving them would be pure N+1 waste.
    const invoicesWithPaymentAdjustments =
      await this.findPaymentAdjustmentInvoiceIds(
        invoices.map((i) => i.id),
      );
    const pending = invoices.filter((invoice) =>
      invoicesWithPaymentAdjustments.has(invoice.id),
    );

    // Resolve in small bounded batches (see RESOLVE_OPERATIONAL_VIEW_CHUNK_SIZE
    // for the single-connection rationale).
    for (let i = 0; i < pending.length; i += RESOLVE_OPERATIONAL_VIEW_CHUNK_SIZE) {
      const chunk = pending.slice(i, i + RESOLVE_OPERATIONAL_VIEW_CHUNK_SIZE);
      const views = await Promise.all(
        chunk.map((invoice) => this.resolveOperationalViewSafe(invoice.id)),
      );
      for (let j = 0; j < chunk.length; j++) {
        const opView = views[j];

        if (opView?.operational.hasDifferences) {
          const opPayments = opView.operational.payments;
          const fiscalPayments = opView.fiscal.fullData?.payments;

          // Remove fiscal (original) payment amounts for this invoice
          if (fiscalPayments) {
            for (const fp of fiscalPayments) {
              const current = adjusted.get(fp.paymentMethodId) ?? new Prisma.Decimal(0);
              adjusted.set(fp.paymentMethodId, current.minus(new Prisma.Decimal(fp.amount)));
            }
          }

          // Add operational (adjusted) payment amounts
          for (const op of opPayments) {
            const resolvedId = paymentMethodResolver(op.paymentMethodId);
            const current = adjusted.get(resolvedId) ?? new Prisma.Decimal(0);
            adjusted.set(resolvedId, current.plus(new Prisma.Decimal(op.amount)));
          }
        } else if (!opView) {
          // Fallback: query PAYMENT_METHOD_CHANGE adjustments directly
          await this.applyAdjustmentsDirect(chunk[j].id, adjusted, paymentMethodResolver);
        }
      }
    }

    return adjusted;
  }

  /**
   * Invoice ids that carry a non-reversed payment-affecting adjustment
   * (PAYMENT_METHOD_CHANGE, PAYMENT_SPLIT_CHANGE or their REVERSAL). Only
   * these invoices can have an operational payment view that differs from
   * the fiscal one, so callers pre-filter with this to avoid resolving
   * every invoice.
   */
  private async findPaymentAdjustmentInvoiceIds(
    invoiceIds: string[],
  ): Promise<Set<string>> {
    if (invoiceIds.length === 0) return new Set();

    const rows = await this.prisma.invoiceLocalAdjustment.findMany({
      where: {
        invoiceId: { in: invoiceIds },
        adjustmentType: {
          in: [
            InvoiceAdjustmentType.PAYMENT_METHOD_CHANGE,
            InvoiceAdjustmentType.PAYMENT_SPLIT_CHANGE,
            InvoiceAdjustmentType.REVERSAL,
          ],
        },
        replacedByAdjustmentId: null,
      },
      select: { invoiceId: true },
    });
    return new Set(rows.map((a) => a.invoiceId));
  }

  /**
   * Resolve the operational view for a single invoice, never throwing.
   * On failure returns null so the caller can fall back to the direct
   * adjustment query.
   */
  private async resolveOperationalViewSafe(
    invoiceId: string,
  ): Promise<OperationalInvoiceView | null> {
    try {
      return await this.adjustmentService!.resolveOperationalView(invoiceId);
    } catch (err) {
      console.error(
        `[CashShiftService] resolveOperationalView failed for invoice ${invoiceId}: `,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Fallback: query PAYMENT_METHOD_CHANGE adjustments directly from the
   * InvoiceLocalAdjustment table and apply them to the totals map.
   * Used when resolveOperationalView throws for a specific invoice.
   *
   * The `paymentMethodResolver` is the function returned by
   * `buildPaymentMethodResolver`. It normalizes whatever is stored in
   * `newValue.paymentMethodId` (which is sometimes a `PaymentMethodCategory`
   * enum value written by the adjustment-creation modal) back to a real
   * `PaymentMethod.id` UUID before mutating `adjusted`.
   */
  private async applyAdjustmentsDirect(
    invoiceId: string,
    adjusted: Map<string, Prisma.Decimal>,
    paymentMethodResolver: (rawId: string) => string,
  ): Promise<void> {
    try {
      const adjustments = await this.prisma.invoiceLocalAdjustment.findMany({
        where: {
          invoiceId,
          adjustmentType: 'PAYMENT_METHOD_CHANGE',
          replacedByAdjustmentId: null,
        },
        select: {
          newValue: true,
        },
      });

      if (adjustments.length === 0) return;

      for (const adj of adjustments) {
        const nv = adj.newValue as {
          paymentMethodId?: string;
        } | null;
        if (!nv?.paymentMethodId) continue;

        // Get the invoice to find the sale
        const inv = await this.prisma.invoice.findUnique({
          where: { id: invoiceId },
          select: { saleId: true, fullData: true },
        });
        if (!inv) continue;

        // Get original SalePayment amounts for this sale
        const salePayments = await this.prisma.salePayment.findMany({
          where: { saleId: inv.saleId },
          select: { paymentMethodId: true, amount: true },
        });

        // Subtract original amounts
        for (const sp of salePayments) {
          const current = adjusted.get(sp.paymentMethodId) ?? new Prisma.Decimal(0);
          adjusted.set(sp.paymentMethodId, current.minus(sp.amount));
        }

        // Calculate total from the invoice fullData if possible,
        // otherwise sum the SalePayment amounts
        const fullData = inv.fullData as Record<string, unknown> | null;
        const invoiceTotal = typeof fullData?.totalAmount === 'string'
          ? fullData.totalAmount
          : salePayments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0)).toString();

        const adjAmount = new Prisma.Decimal(invoiceTotal);
        // Normalize: the modal may have stored a category enum like
        // "BANK_TRANSFER" in the paymentMethodId field. Resolve to a real
        // PaymentMethod.id before writing into the totals map so the
        // downstream `getActivePaymentMethodsWithNames` lookup hits.
        const resolvedId = paymentMethodResolver(nv.paymentMethodId);
        const current = adjusted.get(resolvedId) ?? new Prisma.Decimal(0);
        adjusted.set(resolvedId, current.plus(adjAmount));
      }
    } catch (fallbackErr) {
      console.error(
        `[CashShiftService] Fallback adjustment lookup also failed for invoice ${invoiceId}: `,
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      );
    }
  }

  /**
   * Build a function that normalizes a raw payment-method identifier
   * (which may be a `PaymentMethod.id` UUID or, due to a known
   * adjustment-creation-modal quirk, a `PaymentMethodCategory` enum
   * value like "BANK_TRANSFER") into a real `PaymentMethod.id`.
   *
   * The implementation pre-loads every active `PaymentMethod` once,
   * builds a `category → id` map keyed by enum string, and the returned
   * closure applies the lookup with a small in-memory cache so repeated
   * calls within a single `computeExpectedTotalsByPaymentMethod`
   * invocation don't re-scan the map.
   */
  private async buildPaymentMethodResolver(): Promise<(rawId: string) => string> {
    const methods = await this.prisma.paymentMethod.findMany({
      where: { isActive: true },
      select: { id: true, category: true },
    });

    // Defensive: when the caller (e.g. unit-test mocks) returns nothing
    // we still need the closure to work as an identity function rather
    // than crashing on `methods.map`.
    const safeMethods: Array<{ id: string; category: string }> = Array.isArray(methods)
      ? methods
      : [];

    // Map from category enum value → first active PaymentMethod.id
    // sharing that category. If multiple methods share a category
    // (e.g. two cash drawers), we pick the first one and the safety-net
    // query in `getActivePaymentMethods` will still surface the others
    // when their adjustment values are non-zero.
    const categoryToId = new Map<string, string>();
    for (const m of safeMethods) {
      if (m.category && !categoryToId.has(m.category)) {
        categoryToId.set(m.category, m.id);
      }
    }
    const knownIds = new Set(safeMethods.map((m) => m.id));

    const memo = new Map<string, string>();
    return (rawId: string) => {
      const cached = memo.get(rawId);
      if (cached !== undefined) return cached;

      let resolved: string;
      if (knownIds.has(rawId)) {
        // Already a real PaymentMethod.id — pass through.
        resolved = rawId;
      } else if (categoryToId.has(rawId)) {
        // A category enum value (e.g. "BANK_TRANSFER") — map to the
        // canonical PaymentMethod.id for that category.
        resolved = categoryToId.get(rawId) as string;
      } else {
        // Unknown — leave as-is. Downstream lookups will simply not find
        // a match, which preserves the previous (broken) behavior for
        // genuinely unknown ids rather than throwing.
        resolved = rawId;
      }
      memo.set(rawId, resolved);
      return resolved;
    };
  }

  /**
   * Detect "reconciliation drift" — invoices in a closed shift whose
   * operational view payment methods differ from the fiscal view recorded
   * at close time. This can happen when a manager applies a
   * PAYMENT_METHOD_CHANGE adjustment after the shift was closed.
   *
   * Returns a list of affected invoice IDs and the drift details.
   * Closed shifts are never retroactively edited.
   */
  async getReconciliationDrift(
    shiftId: string,
  ): Promise<Array<{
    invoiceId: string;
    invoiceNumber: string;
    fiscalPaymentSummary: string;
    operationalPaymentSummary: string;
  }>> {
    if (!this.adjustmentService) {
      return [];
    }

    const shift = await this.prisma.cashShift.findUnique({
      where: { id: shiftId },
    });

    if (!shift || shift.state !== 'CLOSED') {
      return [];
    }

    const sales = await this.prisma.sale.findMany({
      where: {
        cashShiftId: shiftId,
        operationalState: 'CONFIRMED',
      },
      select: { id: true },
    });

    const saleIds = sales.map((s) => s.id);
    const invoices = await this.prisma.invoice.findMany({
      where: { saleId: { in: saleIds } },
      select: { id: true, invoiceNumber: true },
    });

    if (invoices.length === 0) return [];

    // Drift compares the payment view, which only changes through non-reversed
    // payment-affecting adjustments — for every other invoice the operational
    // payments equal the fiscal ones, so resolving its view would be pure
    // N+1 waste. Pre-filter to the invoices that can actually drift (same
    // filter used by computeExpectedTotalsByPaymentMethod).
    const pendingInvoiceIds = await this.findPaymentAdjustmentInvoiceIds(
      invoices.map((i) => i.id),
    );
    const pending = invoices.filter((invoice) =>
      pendingInvoiceIds.has(invoice.id),
    );

    const drift: Array<{
      invoiceId: string;
      invoiceNumber: string;
      fiscalPaymentSummary: string;
      operationalPaymentSummary: string;
    }> = [];

    // Resolve in small bounded batches (see
    // RESOLVE_OPERATIONAL_VIEW_CHUNK_SIZE for the single-connection
    // rationale). resolveOperationalViewSafe never throws, so one malformed
    // invoice cannot reject the whole batch.
    for (let i = 0; i < pending.length; i += RESOLVE_OPERATIONAL_VIEW_CHUNK_SIZE) {
      const chunk = pending.slice(i, i + RESOLVE_OPERATIONAL_VIEW_CHUNK_SIZE);
      const views = await Promise.all(
        chunk.map((invoice) => this.resolveOperationalViewSafe(invoice.id)),
      );

      for (let j = 0; j < chunk.length; j++) {
        try {
          const opView = views[j];
          if (!opView?.operational.hasDifferences) continue;

          const fiscalPayments = opView.fiscal.fullData.payments;
          const operationalPayments = opView.operational.payments;

          // Compare payment methods
          const fiscalSummary = fiscalPayments
            .map((p: { paymentMethodName: string; amount: string }) => `${p.paymentMethodName}:${p.amount}`)
            .join(';');
          const operationalSummary = operationalPayments
            .map((p) => `${p.paymentMethodName}:${p.amount}`)
            .join(';');

          if (fiscalSummary !== operationalSummary) {
            drift.push({
              invoiceId: chunk[j].id,
              invoiceNumber: chunk[j].invoiceNumber,
              fiscalPaymentSummary: fiscalSummary,
              operationalPaymentSummary: operationalSummary,
            });
          }
        } catch {
          // Malformed invoice data — skip, same as the old per-invoice guard.
          continue;
        }
      }
    }

    return drift;
  }

  /**
   * Fiscal vs operational payment-method comparison for the reconciliation
   * screen of a shift.
   *
   * Fiscal totals are the direct `SalePayment` sums recorded at sale time;
   * operational totals layer non-reversed payment adjustments on top. The
   * fiscal map is computed once and reused as the base of the operational
   * computation, so the whole comparison costs a single GROUP BY aggregation
   * plus the same adjustment resolution the close wizard already performs.
   *
   * `adjustmentCount` is the number of non-reversed payment-affecting
   * adjustments on invoices of the shift (drift banner badge).
   */
  async getShiftFiscalComparison(shiftId: string): Promise<ShiftFiscalComparison> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const fiscalTotals = await this.getDirectPaymentTotals(shiftId);
    // The comparison stays sales-only on both sides: credit payments (abonos)
    // are not invoice payments, so including them here would look like drift.
    // The close wizard adds them separately (see getShiftSalesSummary).
    const operationalTotals = await this.computeExpectedTotalsByPaymentMethod(
      shiftId,
      fiscalTotals,
      { includeCreditPayments: false },
    );

    // Union of both maps so a method that was fully replaced (fiscal $X,
    // operational $0) still appears in the comparison.
    const methodIds = new Set([
      ...fiscalTotals.keys(),
      ...operationalTotals.keys(),
    ]);

    let totals: ShiftFiscalComparison['totals'] = [];
    if (methodIds.size > 0) {
      const methods = await this.prisma.paymentMethod.findMany({
        where: { id: { in: [...methodIds] } },
        select: { id: true, name: true, isCash: true },
      });
      const methodMap = new Map(methods.map((m) => [m.id, m]));
      totals = [...methodIds].map((paymentMethodId) => {
        const fiscalAmount =
          fiscalTotals.get(paymentMethodId) ?? new Prisma.Decimal(0);
        const operationalAmount =
          operationalTotals.get(paymentMethodId) ?? new Prisma.Decimal(0);
        const method = methodMap.get(paymentMethodId);
        return {
          paymentMethodId,
          methodName: method?.name ?? paymentMethodId,
          isCash: method?.isCash ?? false,
          fiscalAmount: fiscalAmount.toString(),
          operationalAmount: operationalAmount.toString(),
        };
      });
    }

    // Non-reversed payment-affecting adjustments on the shift's invoices,
    // counted in a single joined query (no per-invoice resolution).
    let adjustmentCount = 0;
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int AS "count"
           FROM "InvoiceLocalAdjustment" ila
           JOIN "Invoice" i ON i."id" = ila."invoiceId"
           JOIN "Sale" s ON s."id" = i."saleId"
          WHERE ila."adjustmentType" IN ($2, $3, $4)
            AND ila."replacedByAdjustmentId" IS NULL
            AND s."cashShiftId" = $1
            AND s."operationalState" = $5`,
        shiftId,
        InvoiceAdjustmentType.PAYMENT_METHOD_CHANGE,
        InvoiceAdjustmentType.PAYMENT_SPLIT_CHANGE,
        InvoiceAdjustmentType.REVERSAL,
        SaleOperationalState.CONFIRMED,
      );
      adjustmentCount = rows[0]?.count ?? 0;
    } catch {
      // Non-critical — the comparison table still renders without the count.
    }

    const hasDrift = totals.some(
      (row) => row.fiscalAmount !== row.operationalAmount,
    );
    // Sum of positive (operational − fiscal) deltas: the total amount that
    // actually moved between methods. A plain sum of absolute differences
    // would double-count a pure transfer (CARD −$100 + CASH +$100 → $200)
    // while the comparison table's net total shows $0.
    const driftAmount = totals
      .reduce((acc, row) => {
        const diff = new Prisma.Decimal(row.operationalAmount).minus(
          new Prisma.Decimal(row.fiscalAmount),
        );
        return acc.plus(diff.isNegative() ? new Prisma.Decimal(0) : diff);
      }, new Prisma.Decimal(0))
      .toString();

    return { hasDrift, adjustmentCount, driftAmount, totals };
  }

  // ---------------------------------------------------------------------------
  // History & hydration
  // ---------------------------------------------------------------------------

  /**
   * Fetch shift history for the current workstation.
   * Returns both open and closed shifts, newest first.
   *
   * Pagination: keyset (`cursor`) is preferred for large histories because
   * OFFSET re-scans and discards rows on every page. A tie-breaker on `id`
   * keeps the cursor unambiguous when several shifts share the same
   * `openedAt`. `offset` is kept for backward compatibility (prev/next UI
   * and report shift-picker still use it).
   */
  async getShiftHistory(options?: {
    limit?: number;
    offset?: number;
    /** Keyset pagination cursor — the id of the last row of the previous page. */
    cursor?: { id: string };
  }): Promise<{ shifts: CashShiftRecord[]; total: number }> {
    const session = this.auth.requireRole(
      RoleType.CASHIER,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ADMIN,
    );
    const { limit = 20, offset = 0, cursor } = options ?? {};

    const [shifts, total] = await Promise.all([
      this.prisma.cashShift.findMany({
        where: { workstationId: session.workstationId },
        orderBy: [{ openedAt: 'desc' as const }, { id: 'desc' as const }],
        take: limit,
        ...(cursor
          ? { skip: 1, cursor: { id: cursor.id } }
          : { skip: offset }),
      }) as Promise<CashShiftRecord[]>,
      this.prisma.cashShift.count({
        where: { workstationId: session.workstationId },
      }),
    ]);

    return { shifts, total };
  }

  /**
   * Re-hydrate the in-memory cash shift store from the local database.
   *
   * Reads the current session's workstationId and queries for the most
   * recent OPEN shift. Useful after login / user switch to ensure the
   * store reflects the correct workstation state.
   */
  async hydrateStore(): Promise<void> {
    const session = useLocalSessionStore.getState().session;
    if (!session?.workstationId) {
      useCashShiftStore.getState().setCurrentShift(null);
      return;
    }

    try {
      const openShift = (await this.prisma.cashShift.findFirst({
        where: { workstationId: session.workstationId, state: 'OPEN' },
        orderBy: { openedAt: 'desc' },
      })) as CashShiftRecord | null;

      useCashShiftStore.getState().setCurrentShift(openShift);
    } catch {
      useCashShiftStore.getState().setCurrentShift(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Close-prep helpers
  // ---------------------------------------------------------------------------

  /**
   * Sales summary for a shift: transaction count, total amount, and expected
   * totals per payment method (operational view when adjustment service
   * is available, otherwise direct from invoice payments).
   *
   * @param totalsByMethod  Precomputed expected totals per payment method.
   *   When provided, the expensive operational-view resolution is skipped
   *   and the map is used directly (e.g. the drift comparison already
   *   computed it for the open shift).
   */
  async getShiftSalesSummary(
    shiftId: string,
    totalsByMethod?: Map<string, Prisma.Decimal>,
  ): Promise<{
    transactionCount: number;
    totalSalesAmount: string;
    totalsByPaymentMethod: Array<{
      paymentMethodId: string;
      methodName: string;
      isCash: boolean;
      expectedAmount: string;
      /** Amount of the expected total that came from credit payments (abonos). */
      creditPaymentAmount: string;
    }>;
  }> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    // Count and total aggregated in SQL — no row materialization in JS.
    const aggregate = await this.prisma.sale.aggregate({
      where: { cashShiftId: shiftId, operationalState: 'CONFIRMED' },
      _count: true,
      _sum: { totalAmount: true },
    });

    const totalAmount = aggregate._sum.totalAmount ?? new Prisma.Decimal(0);

    // Compute expected amounts via operational view (or fallback) ONCE —
    // this is the expensive path (small resolveOperationalView batches) —
    // and derive the active-methods list from the same computation instead
    // of re-running the resolution loop inside getActivePaymentMethods.
    // Reuse the caller-provided map (e.g. from the drift comparison) when
    // available so the resolution does not run a second time.
    const totalsByMethodComputed =
      totalsByMethod ?? (await this.computeExpectedTotalsWithFallback(shiftId));

    // When the caller reused the drift comparison's operational map (which is
    // sales-only by design — see getShiftFiscalComparison), merge the credit
    // payments here so the wizard's expected drawer amounts always include
    // abonos regardless of where the totals came from. computeExpectedTotals
    // already includes them, so merging twice would double count. The abono
    // map is fetched once and reused for both the merge and the per-method
    // breakdown field.
    const creditPaymentTotals = await this.getCreditPaymentTotals(shiftId);
    const totalsByMethodWithCreditPayments = totalsByMethod
      ? await this.mergeCreditPaymentTotals(
          shiftId,
          totalsByMethod,
          creditPaymentTotals,
        )
      : totalsByMethodComputed;
    const activeMethods = await this.getActivePaymentMethodsWithNames(
      shiftId,
      totalsByMethodWithCreditPayments,
    );

    const totalsByMethodArray = activeMethods.map((m) => ({
      paymentMethodId: m.id,
      methodName: m.name,
      isCash: m.isCash,
      expectedAmount: (totalsByMethodWithCreditPayments.get(m.id) ?? new Prisma.Decimal(0)).toString(),
      creditPaymentAmount: (
        creditPaymentTotals.get(m.id) ?? new Prisma.Decimal(0)
      ).toString(),
    }));

    return {
      transactionCount: aggregate._count,
      totalSalesAmount: totalAmount.toString(),
      totalsByPaymentMethod: totalsByMethodArray,
    };
  }

  /**
   * Register CLOSING cash counts for multiple payment methods at once,
   * then immediately close the shift. This is the standard close flow
   * used by the UI wizard.
   *
   * Each entry must include the declared amount. For cash methods an
   * optional denominations breakdown can be provided.
   *
   * Throws `MissingClosingCashCountsException` if not all active payment
   * methods are covered.
   */
  async closeWithCounts(
    shiftId: string,
    dto: {
      counts: Array<{
        paymentMethodId: string;
        declaredAmount: Prisma.Decimal;
        denominationsBreakdown?: Record<string, number>;
      }>;
      closingNotes?: string;
    },
  ): Promise<unknown> {
    // Serialize the whole flow under the PGlite write lock. On the single
    // connection nothing can interleave between awaits, so the internal
    // count/close variants skip re-reading the shift — and a second close
    // (wizard double-click) waits here, then fails cleanly with
    // `ShiftNotOpenException` instead of writing duplicated CLOSING counts.
    //
    // The mandatory backup inside closeShiftInternal dumps the whole DB, so
    // the background is paused before acquiring: sync steps arriving mid-close
    // skip instead of queueing, and the foreground acquire jumps the queue.
    dbWriteLock.pauseBackground();
    try {
      await dbWriteLock.acquire('foreground');
      try {
        const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);
        // Single open-shift validation for the whole flow.
        await this.getOpenShift(shiftId);

        // 1. Compute expected totals per payment method
        const expectedTotals = await this.computeExpectedTotalsWithFallback(shiftId);

      // 2. Fetch payment methods for isCash check — only the fields the
      //    methodMap and the internal count registration consume.
      const paymentMethods = await this.prisma.paymentMethod.findMany({
        where: { id: { in: dto.counts.map((c) => c.paymentMethodId) } },
        select: { id: true, isCash: true },
      });
      const methodMap = new Map(paymentMethods.map((m) => [m.id, m]));

      // 3. Register each CLOSING count with the computed expected amount
      for (const count of dto.counts) {
        const method = methodMap.get(count.paymentMethodId);
        if (!method) throw new PaymentMethodNotFoundException(count.paymentMethodId);

        const expectedAmount = expectedTotals.get(count.paymentMethodId) ?? new Prisma.Decimal(0);

        await this.registerCashCountInternal(
          shiftId,
          {
            countType: 'CLOSING',
            paymentMethodId: count.paymentMethodId,
            expectedAmount,
            declaredAmount: count.declaredAmount,
            denominationsBreakdown: count.denominationsBreakdown,
          },
          session,
          // Already loaded above — skip the per-count findUnique.
          method,
        );
      }

      // 4. Close the shift — validates all methods have CLOSING counts. The
      //    already-computed totals are reused so the operational-view
      //    resolution inside closeShift's active-methods check does not run
      //    a second time.
      return this.closeShiftInternal(
        shiftId,
        { closingNotes: dto.closingNotes ?? undefined },
        expectedTotals,
        session,
      );
      } finally {
        dbWriteLock.release();
      }
    } finally {
      dbWriteLock.resumeBackground();
    }
  }

  /**
   * Get active payment methods (used in confirmed sales within the shift)
   * including their names and isCash flag.
   *
   * When `totals` is provided (already computed by the caller) it is reused
   * so the expensive operational-view resolution runs exactly once per
   * summary instead of once here and once in the caller.
   */
  private async getActivePaymentMethodsWithNames(
    shiftId: string,
    totals?: Map<string, Prisma.Decimal>,
  ): Promise<Array<{ id: string; name: string; isCash: boolean }>> {
    const activeIds = await this.getActivePaymentMethods(shiftId, totals);
    if (activeIds.length === 0) return [];

    const methods = await this.prisma.paymentMethod.findMany({
      where: { id: { in: activeIds.map((a) => a.paymentMethodId) } },
      select: { id: true, name: true, isCash: true },
    });
    return methods;
  }

  /**
   * Compute expected totals per payment method for a shift.
   * Delegates to `computeExpectedTotalsByPaymentMethod` which handles
   * both direct SalePayment sums and operational-view adjustments.
   */
  private async computeExpectedTotalsWithFallback(
    shiftId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    return this.computeExpectedTotalsByPaymentMethod(shiftId);
  }

  /**
   * Direct SalePayment sum per payment method for a shift.
   * Used as the base for operational-view calculations.
   *
   * Aggregated in PostgreSQL with a single GROUP BY — the database walks the
   * index and sums instead of loading every payment row into the webview.
   */
  private async getDirectPaymentTotals(
    shiftId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const groups = await this.prisma.salePayment.groupBy({
      by: ['paymentMethodId'],
      where: {
        sale: { cashShiftId: shiftId, operationalState: 'CONFIRMED' },
      },
      _sum: { amount: true },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const group of groups) {
      totals.set(
        group.paymentMethodId,
        group._sum.amount ?? new Prisma.Decimal(0),
      );
    }
    return totals;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getOpenShift(shiftId: string): Promise<CashShiftRecord> {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id: shiftId },
    });

    if (!shift || shift.state !== 'OPEN') {
      throw new ShiftNotOpenException();
    }

    return shift;
  }

  private async assertNoOpenShiftExists(workstationId: string): Promise<void> {
    const openShift = await this.prisma.cashShift.findFirst({
      where: {
        workstationId,
        state: 'OPEN',
      },
    });

    if (openShift) {
      throw new ShiftAlreadyOpenException();
    }
  }

  /**
   * Get payment method IDs that are operationally active (have non-zero
   * expected totals) within the shift.
   *
   * Derives the set from `computeExpectedTotalsByPaymentMethod` which
   * correctly accounts for PAYMENT_METHOD_CHANGE adjustments: if an
   * invoice's payment was moved from method A to method B, method A
   * appears as $0 (excluded) and method B appears with the full amount
   * (included).
   *
   * As a safety net, also queries PAYMENT_METHOD_CHANGE adjustments
   * directly to ensure the new method IDs are always in the active set
   * even if the totals computation returned $0 for them.
   */
  private async getActivePaymentMethods(
    shiftId: string,
    totals?: Map<string, Prisma.Decimal>,
  ): Promise<{ paymentMethodId: string }[]> {
    const totalsMap =
      totals ?? (await this.computeExpectedTotalsByPaymentMethod(shiftId));
    const activeSet = new Set<string>();

    for (const [paymentMethodId, amount] of totalsMap) {
      if (amount.greaterThan(0)) {
        activeSet.add(paymentMethodId);
      }
    }

    // Safety net: include any payment method referenced by a non-reversed
    // PAYMENT_METHOD_CHANGE adjustment in this shift. The resolver handles
    // the case where the modal stored a category enum in paymentMethodId.
    try {
      const paymentMethodResolver = await this.buildPaymentMethodResolver();
      await this.addAdjustmentMethodIds(shiftId, activeSet, paymentMethodResolver);
    } catch {
      // Non-critical safety net — totals-based result already computed
    }

    return Array.from(activeSet).map((paymentMethodId) => ({ paymentMethodId }));
  }

  /**
   * Query PAYMENT_METHOD_CHANGE adjustments for the shift and add their
   * target payment method IDs to the active set. Each id is normalized
   * through `paymentMethodResolver` so category-enum strings (e.g.
   * "BANK_TRANSFER") become real `PaymentMethod.id` UUIDs.
   */
  private async addAdjustmentMethodIds(
    shiftId: string,
    activeSet: Set<string>,
    paymentMethodResolver: (rawId: string) => string,
  ): Promise<void> {
    // Single joined query: the schema declares no Prisma relations between
    // InvoiceLocalAdjustment, Invoice and Sale, so a raw JOIN replaces the
    // previous sale → invoice → adjustment chain. All filtering happens in
    // the database over indexed columns (Sale.cashShiftId_operationalState,
    // Invoice.saleId) instead of loading every sale/invoice id of the shift
    // into the webview first.
    const adjustments = await this.prisma.$queryRawUnsafe<
      Array<{ newValue: Prisma.JsonValue | null }>
    >(
      `SELECT ila."newValue"
         FROM "InvoiceLocalAdjustment" ila
         JOIN "Invoice" i ON i."id" = ila."invoiceId"
         JOIN "Sale" s ON s."id" = i."saleId"
        WHERE ila."adjustmentType" = $2
          AND ila."replacedByAdjustmentId" IS NULL
          AND s."cashShiftId" = $1
          AND s."operationalState" = $3`,
      shiftId,
      InvoiceAdjustmentType.PAYMENT_METHOD_CHANGE,
      SaleOperationalState.CONFIRMED,
    );

    for (const adj of adjustments) {
      const nv = adj.newValue as { paymentMethodId?: string } | null;
      if (nv?.paymentMethodId) {
        activeSet.add(paymentMethodResolver(nv.paymentMethodId));
      }
    }
  }

  private findMissingClosingCounts(
    activePaymentMethods: { paymentMethodId: string }[],
    closingCounts: { paymentMethodId: string }[],
  ): string[] {
    const closingMethodIds = new Set(
      closingCounts.map((c) => c.paymentMethodId),
    );

    return activePaymentMethods
      .filter((m) => !closingMethodIds.has(m.paymentMethodId))
      .map((m) => m.paymentMethodId);
  }

  private computeClosingTotals(
    closingCounts: {
      expectedAmount: Prisma.Decimal;
      declaredAmount: Prisma.Decimal;
    }[],
  ): { expectedAmount: Prisma.Decimal; actualAmount: Prisma.Decimal } {
    let expectedAmount = new Prisma.Decimal(0);
    let actualAmount = new Prisma.Decimal(0);

    for (const count of closingCounts) {
      expectedAmount = expectedAmount.plus(count.expectedAmount);
      actualAmount = actualAmount.plus(count.declaredAmount);
    }

    return { expectedAmount, actualAmount };
  }

  /**
   * Fire-and-forget print routing after a shift close.
   * Extracted so the audit-write + print post-close flow stays clean.
   */
  private async handlePostClose(
    updatedShift: CashShiftRecord & { cashCounts: unknown[] },
    session: { userId: string; workstationId: string; role: string },
    closingCounts: Array<{ paymentMethodId: string; paymentMethodIsCash: boolean; expectedAmount: Prisma.Decimal; declaredAmount: Prisma.Decimal; difference: Prisma.Decimal } & { paymentMethod?: { name: string } }>,
    _shiftId: string,
    _closingNotes?: string,
  ): Promise<CashShiftRecord & { cashCounts: unknown[] }> {
    if (this.printRouter) {
      try {
        const closeHtml = generateShiftCloseHtml({
          shiftId: updatedShift.id,
          workstationId: session.workstationId,
          cashierName: session.userId,
          openedAt: updatedShift.openedAt,
          closedAt: updatedShift.closedAt!,
          openingBalance: updatedShift.openingBalance.toString(),
          expectedClosingAmount: updatedShift.expectedClosingAmount.toString(),
          actualClosingAmount: updatedShift.actualClosingAmount.toString(),
          closingDifference: updatedShift.closingDifference.toString(),
          closingNotes: updatedShift.closingNotes,
          paymentMethodCounts: closingCounts.map((cc) => ({
            methodName: cc.paymentMethod?.name ?? cc.paymentMethodId,
            isCash: cc.paymentMethodIsCash,
            expectedAmount: cc.expectedAmount.toString(),
            declaredAmount: cc.declaredAmount.toString(),
            difference: cc.difference.toString(),
          })),
        });

        const closePath = await writePrintPayload(
          `shift-close-${updatedShift.id}.html`,
          closeHtml,
        );

        await this.printRouter.print(PrintJobType.SHIFT_CLOSE_REPORT, {
          payloadPath: closePath,
          payloadType: PrintPayloadType.HTML,
        });
      } catch (err) {
        console.error(
          `[CashShiftService] Print routing failed for shift close ${updatedShift.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return updatedShift;
  }

  /**
   * Return all active payment methods as a simple id/category/name/isCash
   * list, sorted by sortOrder. This is the single source of truth for every
   * payment-method picker in the app (sales, adjustments, returns) so all
   * sections always show the same DIAN categories stored in the database.
   */
  async getActivePaymentMethodsList(): Promise<
    Array<{ id: string; category: string; name: string; isCash: boolean }>
  > {
    const methods = await this.prisma.paymentMethod.findMany({
      where: { isActive: true },
      select: { id: true, category: true, name: true, isCash: true },
      orderBy: { sortOrder: 'asc' },
    });
    const list = Array.isArray(methods) ? methods : [];
    // Store credit is a per-station opt-in (Settings → Sales). While the
    // creditEnabled switch is off, hide the CREDIT method from every picker;
    // the reconciliation paths read the DB directly, so historical credit
    // sales still reconcile regardless of the toggle.
    if (!getSalesConfig().creditEnabled) {
      return list.filter((m) => m.category !== 'CREDIT');
    }
    return list;
  }

  private generateId(): string {
    return globalThis.crypto.randomUUID();
  }
}

/**
 * Fiscal vs operational payment-method comparison for a shift's
 * reconciliation screen. Amounts are in COP (pesos) as strings.
 */
export type ShiftFiscalComparison = {
  /** True when any payment method's operational amount differs from fiscal. */
  hasDrift: boolean;
  /** Non-reversed payment-affecting adjustments on the shift's invoices. */
  adjustmentCount: number;
  /** Sum of absolute fiscal−operational differences, in COP pesos. */
  driftAmount: string;
  /** Per-method comparison; union of fiscal and operational maps. */
  totals: Array<{
    paymentMethodId: string;
    methodName: string;
    isCash: boolean;
    fiscalAmount: string;
    operationalAmount: string;
  }>;
};

/** Minimal type for a CashShift record as read from the local database. */
export type CashShiftRecord = {
  id: string;
  workstationId: string;
  userId: string;
  state: string;
  openedAt: Date;
  closedAt: Date | null;
  closedByUserId: string | null;
  openingBalance: Prisma.Decimal;
  openingNotes: string | null;
  expectedClosingAmount: Prisma.Decimal;
  actualClosingAmount: Prisma.Decimal;
  closingDifference: Prisma.Decimal;
  closingNotes: string | null;
  forcedClose: boolean;
  hasExtendedAlert: boolean;
  createdAt: Date;
  updatedAt: Date;
};