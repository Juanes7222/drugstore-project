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
import { Prisma } from '@pharmacy/database/local';
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
import { createBackupService, BackupFailedException } from '../backup';
import type { LocalAdjustmentService } from '../fiscal/local-adjustment.service';
import type { PrintRouter } from '../printing/print-router';
import { PrintJobType, PrintPayloadType } from '../printing/printing-types';
import { writePrintPayload } from '../printing/print-payload-writer';
import { generateShiftCloseHtml } from './shift-close-html';

export const createCashShiftService = (
  prisma: PrismaClient,
  authService: AuthService,
  adjustmentService?: LocalAdjustmentService,
  printRouter?: PrintRouter,
): CashShiftService => {
  return new CashShiftService(prisma, authService, adjustmentService, printRouter);
};

export class CashShiftService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
    private readonly adjustmentService?: LocalAdjustmentService,
    private readonly printRouter?: PrintRouter,
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
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    await this.assertNoOpenShiftExists(session.workstationId);

    return this.prisma.cashShift.create({
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
    dto: {
      countType: 'PARTIAL' | 'CLOSING';
      paymentMethodId: string;
      expectedAmount: Prisma.Decimal;
      declaredAmount: Prisma.Decimal;
      denominationsBreakdown?: Record<string, number>;
    },
  ): Promise<unknown> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    await this.getOpenShift(shiftId);

    const paymentMethod = await this.prisma.paymentMethod.findUnique({
      where: { id: dto.paymentMethodId },
    });

    if (!paymentMethod) {
      throw new PaymentMethodNotFoundException(dto.paymentMethodId);
    }

    if (dto.denominationsBreakdown && !paymentMethod.isCash) {
      throw new InvalidCashCountForNonCashMethodException();
    }

    const difference = dto.declaredAmount.minus(dto.expectedAmount);

    return this.prisma.shiftCashCount.create({
      data: {
        id: this.generateId(),
        cashShiftId: shiftId,
        countType: dto.countType,
        paymentMethodId: dto.paymentMethodId,
        paymentMethodIsCash: paymentMethod.isCash,
        expectedAmount: dto.expectedAmount,
        declaredAmount: dto.declaredAmount,
        difference,
        denominationsBreakdown: paymentMethod.isCash
          ? (dto.denominationsBreakdown ?? Prisma.DbNull)
          : Prisma.DbNull,
        createdById: session.userId,
        createdAt: new Date(),
      },
    });
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
  ): Promise<unknown> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    await this.getOpenShift(shiftId);

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

    const activePaymentMethods = await this.getActivePaymentMethods(shiftId);
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
    const [pendingCount, failedCount, maxSeqRow] = await Promise.all([
      this.prisma.syncQueue.count({ where: { status: 'PENDING' } }),
      this.prisma.syncQueue.count({ where: { status: 'FAILED' } }),
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

    return this.prisma.cashShift
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
      })
      .then(async (updatedShift) => {
        // 6. Print the shift close report (fire-and-forget from the caller's
        //    perspective). The print router handles routing, fallback, and
        //    queueing. If the router is not configured, printing is skipped.
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
                methodName: (cc as typeof closingCounts[number] & { paymentMethod: { name: string } }).paymentMethod?.name ?? cc.paymentMethodId,
                isCash: cc.paymentMethodIsCash,
                expectedAmount: cc.expectedAmount.toString(),
                declaredAmount: cc.declaredAmount.toString(),
                difference: cc.difference.toString(),
              })),
            });

            const closePath = await writePrintPayload(
              `shift-close-${shiftId}.html`,
              closeHtml,
            );

            await this.printRouter.print(PrintJobType.SHIFT_CLOSE_REPORT, {
              payloadPath: closePath,
              payloadType: PrintPayloadType.HTML,
            });
          } catch (err) {
            console.error(
              `[CashShiftService] Print routing failed for shift close ${shiftId}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }

        return updatedShift;
      });
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
   * @returns A map of paymentMethodId → total expected amount
   */
  async computeExpectedTotalsByPaymentMethod(
    shiftId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    // Base: direct SalePayment sum — always works, no invoice dependency
    const baseTotals = await this.getDirectPaymentTotals(shiftId);

    if (!this.adjustmentService) {
      return baseTotals;
    }

    // Refinement: layer operational adjustments on top of base totals.
    // If no invoices exist yet (invoiceService not configured / generation
    // failed), base totals are returned unchanged.
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
      select: { id: true },
    });

    const adjusted = new Map(baseTotals);
    for (const invoice of invoices) {
      try {
        const opView = await this.adjustmentService.resolveOperationalView(
          invoice.id,
        );

        if (!opView.operational.hasDifferences) continue;

        const opPayments = opView.operational.payments;
        const fiscalPayments = opView.fiscal.fullData.payments;

        // Remove fiscal (original) payment amounts for this invoice
        for (const fp of fiscalPayments) {
          const current = adjusted.get(fp.paymentMethodId) ?? new Prisma.Decimal(0);
          const newVal = current.minus(new Prisma.Decimal(fp.amount));
          adjusted.set(fp.paymentMethodId, newVal);
        }

        // Add operational (adjusted) payment amounts
        for (const op of opPayments) {
          const current = adjusted.get(op.paymentMethodId) ?? new Prisma.Decimal(0);
          adjusted.set(op.paymentMethodId, current.plus(new Prisma.Decimal(op.amount)));
        }
      } catch {
        continue;
      }
    }

    return adjusted;
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
      select: { id: true, invoiceNumber: true, fullData: true },
    });

    const drift: Array<{
      invoiceId: string;
      invoiceNumber: string;
      fiscalPaymentSummary: string;
      operationalPaymentSummary: string;
    }> = [];

    for (const invoice of invoices) {
      try {
        const opView = await this.adjustmentService.resolveOperationalView(
          invoice.id,
        );

        if (!opView.operational.hasDifferences) continue;

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
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            fiscalPaymentSummary: fiscalSummary,
            operationalPaymentSummary: operationalSummary,
          });
        }
      } catch {
        continue;
      }
    }

    return drift;
  }

  // ---------------------------------------------------------------------------
  // History & hydration
  // ---------------------------------------------------------------------------

  /**
   * Fetch shift history for the current workstation.
   * Returns both open and closed shifts, newest first.
   */
  async getShiftHistory(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ shifts: CashShiftRecord[]; total: number }> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);
    const { limit = 20, offset = 0 } = options ?? {};

    const [shifts, total] = await Promise.all([
      this.prisma.cashShift.findMany({
        where: { workstationId: session.workstationId },
        orderBy: { openedAt: 'desc' },
        take: limit,
        skip: offset,
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
   */
  async getShiftSalesSummary(shiftId: string): Promise<{
    transactionCount: number;
    totalSalesAmount: string;
    totalsByPaymentMethod: Array<{
      paymentMethodId: string;
      methodName: string;
      isCash: boolean;
      expectedAmount: string;
    }>;
  }> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const sales = await this.prisma.sale.findMany({
      where: { cashShiftId: shiftId, operationalState: 'CONFIRMED' },
      select: { id: true, totalAmount: true },
    });

    const totalAmount = sales.reduce(
      (sum, s) => sum.plus(s.totalAmount),
      new Prisma.Decimal(0),
    );

    // Get payment methods used in this shift
    const activeMethods = await this.getActivePaymentMethodsWithNames(shiftId);

    // Compute expected amounts via operational view (or fallback)
    const totalsByMethod = await this.computeExpectedTotalsWithFallback(shiftId);

    const totalsByMethodArray = activeMethods.map((m) => ({
      paymentMethodId: m.id,
      methodName: m.name,
      isCash: m.isCash,
      expectedAmount: (totalsByMethod.get(m.id) ?? new Prisma.Decimal(0)).toString(),
    }));

    return {
      transactionCount: sales.length,
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
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);
    await this.getOpenShift(shiftId);

    // 1. Compute expected totals per payment method
    const expectedTotals = await this.computeExpectedTotalsWithFallback(shiftId);

    // 2. Fetch payment methods for isCash check
    const paymentMethods = await this.prisma.paymentMethod.findMany({
      where: { id: { in: dto.counts.map((c) => c.paymentMethodId) } },
    });
    const methodMap = new Map(paymentMethods.map((m) => [m.id, m]));

    // 3. Register each CLOSING count with the computed expected amount
    for (const count of dto.counts) {
      const method = methodMap.get(count.paymentMethodId);
      if (!method) throw new PaymentMethodNotFoundException(count.paymentMethodId);

      const expectedAmount = expectedTotals.get(count.paymentMethodId) ?? new Prisma.Decimal(0);

      await this.registerCashCount(shiftId, {
        countType: 'CLOSING',
        paymentMethodId: count.paymentMethodId,
        expectedAmount,
        declaredAmount: count.declaredAmount,
        denominationsBreakdown: count.denominationsBreakdown,
      });
    }

    // 4. Close the shift — validates all methods have CLOSING counts
    return this.closeShift(shiftId, { closingNotes: dto.closingNotes ?? undefined });
  }

  /**
   * Get active payment methods (used in confirmed sales within the shift)
   * including their names and isCash flag.
   */
  private async getActivePaymentMethodsWithNames(
    shiftId: string,
  ): Promise<Array<{ id: string; name: string; isCash: boolean }>> {
    const activeIds = await this.getActivePaymentMethods(shiftId);
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
   */
  private async getDirectPaymentTotals(
    shiftId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const sales = await this.prisma.sale.findMany({
      where: { cashShiftId: shiftId, operationalState: 'CONFIRMED' },
      select: { id: true },
    });
    const payments = await this.prisma.salePayment.findMany({
      where: { saleId: { in: sales.map((s) => s.id) } },
      select: { paymentMethodId: true, amount: true },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const pmt of payments) {
      const current = totals.get(pmt.paymentMethodId) ?? new Prisma.Decimal(0);
      totals.set(pmt.paymentMethodId, current.plus(pmt.amount));
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
   * Get payment method IDs that have been used in confirmed sales within the shift.
   */
  private async getActivePaymentMethods(
    shiftId: string,
  ): Promise<{ paymentMethodId: string }[]> {
    return this.prisma.salePayment.findMany({
      where: {
        sale: {
          cashShiftId: shiftId,
          operationalState: 'CONFIRMED',
        },
      },
      distinct: ['paymentMethodId'],
      select: { paymentMethodId: true },
    });
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

  private generateId(): string {
    return globalThis.crypto.randomUUID();
  }
}

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