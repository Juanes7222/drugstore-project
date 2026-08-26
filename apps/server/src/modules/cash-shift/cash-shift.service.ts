import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { Prisma } from '@pharmacy/database';
import { OpenCashShiftDto } from './dto/open-cash-shift.dto';
import { RegisterCashCountDto } from './dto/register-cash-count.dto';
import { CloseCashShiftDto } from './dto/close-cash-shift.dto';
import { ForceCloseCashShiftDto } from './dto/force-close-cash-shift.dto';
import { ShiftAlreadyOpenException } from './exceptions/shift-already-open.exception';
import { NoOpenShiftException } from './exceptions/no-open-shift.exception';
import { ShiftNotOpenException } from './exceptions/shift-not-open.exception';
import { MissingClosingCashCountsException } from './exceptions/missing-closing-cash-counts.exception';
import { InvalidCashCountForNonCashMethodException } from './exceptions/invalid-cash-count-for-non-cash-method.exception';
import { PaymentMethodNotFoundException } from './exceptions/payment-method-not-found.exception';
import * as crypto from 'crypto';

const EXTENDED_SHIFT_THRESHOLD_HOURS = 6;

@Injectable()
export class CashShiftService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Opens the store-wide cash shift.
   *
   * `workstationId` records the ORIGIN workstation that opened the shift;
   * it no longer scopes the shift. Under the global shift model exactly one
   * OPEN shift may exist per tenant at any time, and any selling user on
   * any workstation sells into it.
   */
  async openShift(
    workstationId: string,
    userId: string,
    dto: OpenCashShiftDto,
  ): Promise<any> {
    await this.assertNoOpenShiftExists();

    return this.prisma.cashShift.create({
      data: {
        id: this.generateId(),
        subscriptionId: this.tenantContext.getSubscriptionId(),
        workstationId,
        userId,
        openingBalance: dto.openingBalance,
        openingNotes: dto.openingNotes || null,
        openedAt: new Date(),
        state: 'OPEN',
      },
    });
  }

  /**
   * Returns the tenant's current OPEN shift, or throws `NoOpenShiftException`
   * (HTTP 404) when none exists.
   *
   * Consumed by GET /cash-shifts/open so POS workstations can mirror the
   * global open shift locally before selling offline. Deliberately readable
   * by CASHIER-level roles: selling users must be able to discover which
   * shift their sales will attach to.
   */
  async getOpenShift(): Promise<{
    id: string;
    workstationId: string;
    userId: string;
    openedAt: Date;
    openingBalance: Prisma.Decimal;
    state: string;
  }> {
    const shift = await this.prisma.cashShift.findFirst({
      where: { state: 'OPEN' },
      orderBy: { openedAt: 'desc' },
      select: {
        id: true,
        workstationId: true,
        userId: true,
        openedAt: true,
        openingBalance: true,
        state: true,
      },
    });

    if (!shift) {
      throw new NoOpenShiftException();
    }

    return shift;
  }

  async registerCashCount(
    shiftId: string,
    userId: string,
    dto: RegisterCashCountDto,
  ): Promise<any> {
    const shift = await this.requireOpenShiftById(shiftId);

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
        subscriptionId: this.tenantContext.getSubscriptionId(),
        cashShiftId: shiftId,
        countType: dto.countType,
        paymentMethodId: dto.paymentMethodId,
        paymentMethodIsCash: paymentMethod.isCash,
        expectedAmount: dto.expectedAmount,
        declaredAmount: dto.declaredAmount,
        difference,
        denominationsBreakdown: paymentMethod.isCash
          ? dto.denominationsBreakdown ?? Prisma.DbNull
          : Prisma.DbNull,
        createdById: userId,
        createdAt: new Date(),
      },
    });
  }

  async closeShift(
    shiftId: string,
    userId: string,
    dto: CloseCashShiftDto,
  ): Promise<any> {
    const shift = await this.requireOpenShiftById(shiftId);

    const closingCounts = await this.prisma.shiftCashCount.findMany({
      where: {
        cashShiftId: shiftId,
        countType: 'CLOSING',
      },
      include: { paymentMethod: true },
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

    return this.prisma.cashShift.update({
      where: { id: shiftId },
      data: {
        state: 'CLOSED',
        closedAt: new Date(),
        closedByUserId: userId,
        expectedClosingAmount: expectedAmount,
        actualClosingAmount: actualAmount,
        closingDifference,
        closingNotes: dto.closingNotes || null,
      },
    });
  }

  async forceCloseShift(
    shiftId: string,
    userId: string,
    dto: ForceCloseCashShiftDto,
  ): Promise<any> {
    // Business validation: closing notes are required for force-close.
    // Relocated from ForceCloseCashShiftSchema (HTTP DTO) to the service layer
    // so that sync dispatcher replays are also protected.
    if (!dto.closingNotes || dto.closingNotes.trim().length === 0) {
      throw new Error('Closing notes are required for force close');
    }

    const shift = await this.requireOpenShiftById(shiftId);

    const closingCounts = await this.prisma.shiftCashCount.findMany({
      where: {
        cashShiftId: shiftId,
        countType: 'CLOSING',
      },
    });

    const { expectedAmount, actualAmount } =
      this.computeClosingTotals(closingCounts);

    const closingDifference = actualAmount.minus(expectedAmount);

    return this.prisma.cashShift.update({
      where: { id: shiftId },
      data: {
        state: 'FORCED_CLOSE',
        closedAt: new Date(),
        closedByUserId: userId,
        expectedClosingAmount: expectedAmount,
        actualClosingAmount: actualAmount,
        closingDifference,
        closingNotes: dto.closingNotes,
        forcedClose: true,
      },
    });
  }

  /**
   * Flags shifts that have stayed OPEN past the threshold, tenant by tenant.
   *
   * The @Cron job (ExtendedShiftAlertJob) runs outside any request context,
   * so CashShift rows — which are RLS-scoped — are unreachable unless the
   * update runs inside a per-subscription tenant transaction.
   */
  async flagExtendedShifts(): Promise<void> {
    // One tenant transaction per subscription is required by RLS: the cron
    // runs outside any request context and CashShift rows are only visible
    // inside a per-tenant `SET LOCAL app.current_tenant`. Cost is O(#tenants)
    // commits, which is acceptable for a nightly job.
    const subscriptions = await this.prisma.subscription.findMany({
      select: { id: true },
    });

    for (const subscription of subscriptions) {
      await this.prisma.withTenant(subscription.id, async (tx) => {
        const thresholdTime = new Date(
          Date.now() - EXTENDED_SHIFT_THRESHOLD_HOURS * 60 * 60 * 1000,
        );

        await tx.cashShift.updateMany({
          where: {
            state: 'OPEN',
            openedAt: { lt: thresholdTime },
            hasExtendedAlert: false,
          },
          data: { hasExtendedAlert: true },
        });
      });
    }
  }

  /** Loads a shift by id and requires it to still be OPEN. */
  private async requireOpenShiftById(shiftId: string): Promise<any> {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id: shiftId },
    });

    if (!shift || shift.state !== 'OPEN') {
      throw new ShiftNotOpenException();
    }

    return shift;
  }

  /**
   * Global shift model: at most ONE OPEN shift per tenant.
   *
   * Enforced here at the application level — the CashShift schema has no
   * partial unique index on `state = 'OPEN'` yet (see
   * packages/database/prisma/schema-source/shared/cash-shift.prisma), so the
   * database alone does not protect this invariant. Concurrent HTTP opens can
   * still race past this check until that index is added by a future
   * migration; the sync bootstrap path additionally serializes through a
   * PostgreSQL advisory lock (see SyncOperationDispatcherService).
   */
  private async assertNoOpenShiftExists(): Promise<void> {
    const openShift = await this.prisma.cashShift.findFirst({
      where: {
        state: 'OPEN',
      },
    });

    if (openShift) {
      throw new ShiftAlreadyOpenException();
    }
  }

  /**
   * Payment-method ids with activity inside the shift.
   *
   * Active methods come from two sources: confirmed `SalePayment` rows and
   * credit payments (abonos) recorded against the shift. A cashier who
   * collected abonos in cash has that money in the drawer, so a CLOSING
   * count must be registered for those methods too — otherwise the close
   * could be submitted without reconciling the abono cash.
   */
  private async getActivePaymentMethods(shiftId: string): Promise<any[]> {
    const [saleMethods, creditMethods] = await Promise.all([
      this.prisma.salePayment.findMany({
        where: {
          sale: {
            cashShiftId: shiftId,
            operationalState: 'CONFIRMED',
          },
        },
        distinct: ['paymentMethodId'],
        select: { paymentMethodId: true },
      }),
      this.prisma.clientCreditPayment.findMany({
        where: { cashShiftId: shiftId, annulledAt: null },
        distinct: ['paymentMethodId'],
        select: { paymentMethodId: true },
      }),
    ]);

    const seen = new Set(saleMethods.map((m) => m.paymentMethodId));
    return [
      ...saleMethods,
      ...creditMethods.filter((m) => !seen.has(m.paymentMethodId)),
    ];
  }

  private findMissingClosingCounts(
    activePaymentMethods: any[],
    closingCounts: any[],
  ): string[] {
    const closingMethodIds = new Set(
      closingCounts.map((c) => c.paymentMethodId),
    );

    return activePaymentMethods
      .filter((m) => !closingMethodIds.has(m.paymentMethodId))
      .map((m) => m.paymentMethodId);
  }

  private computeClosingTotals(closingCounts: any[]): {
    expectedAmount: any;
    actualAmount: any;
  } {
    let expectedAmount = new Prisma.Decimal(0);
    let actualAmount = new Prisma.Decimal(0);

    for (const count of closingCounts) {
      expectedAmount = expectedAmount.plus(count.expectedAmount);
      actualAmount = actualAmount.plus(count.declaredAmount);
    }

    return { expectedAmount, actualAmount };
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
