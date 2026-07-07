import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OpenCashShiftDto } from './dto/open-cash-shift.dto';
import { RegisterCashCountDto } from './dto/register-cash-count.dto';
import { CloseCashShiftDto } from './dto/close-cash-shift.dto';
import { ForceCloseCashShiftDto } from './dto/force-close-cash-shift.dto';
import { ShiftAlreadyOpenException } from './exceptions/shift-already-open.exception';
import { ShiftNotOpenException } from './exceptions/shift-not-open.exception';
import { MissingClosingCashCountsException } from './exceptions/missing-closing-cash-counts.exception';
import { InvalidCashCountForNonCashMethodException } from './exceptions/invalid-cash-count-for-non-cash-method.exception';
import { PaymentMethodNotFoundException } from './exceptions/payment-method-not-found.exception';
import * as crypto from 'crypto';

const EXTENDED_SHIFT_THRESHOLD_HOURS = 6;

@Injectable()
export class CashShiftService {
  constructor(private prisma: PrismaService) {}

  async openShift(
    workstationId: string,
    userId: string,
    dto: OpenCashShiftDto,
  ): Promise<any> {
    await this.assertNoOpenShiftExists(workstationId);

    return this.prisma.cashShift.create({
      data: {
        id: this.generateId(),
        workstationId,
        userId,
        openingBalance: dto.openingBalance,
        openingNotes: dto.openingNotes || null,
        openedAt: new Date(),
        state: 'OPEN',
      },
    });
  }

  async registerCashCount(
    shiftId: string,
    userId: string,
    dto: RegisterCashCountDto,
  ): Promise<any> {
    const shift = await this.getOpenShift(shiftId);

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
    const shift = await this.getOpenShift(shiftId);

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
    const shift = await this.getOpenShift(shiftId);

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

  async flagExtendedShifts(): Promise<void> {
    const thresholdTime = new Date(
      Date.now() - EXTENDED_SHIFT_THRESHOLD_HOURS * 60 * 60 * 1000,
    );

    await this.prisma.cashShift.updateMany({
      where: {
        state: 'OPEN',
        openedAt: { lt: thresholdTime },
        hasExtendedAlert: false,
      },
      data: { hasExtendedAlert: true },
    });
  }

  private async getOpenShift(shiftId: string): Promise<any> {
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

  private async getActivePaymentMethods(shiftId: string): Promise<any[]> {
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
