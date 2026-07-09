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
import { createBackupService, BackupFailedException } from '../backup';

export const createCashShiftService = (
  prisma: PrismaClient,
  authService: AuthService,
): CashShiftService => {
  return new CashShiftService(prisma, authService);
};

export class CashShiftService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
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

    return this.prisma.cashShift.update({
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
    });
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