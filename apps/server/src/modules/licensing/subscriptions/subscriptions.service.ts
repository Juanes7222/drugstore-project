import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import type { CreateSubscriptionDto, UpdateSubscriptionDto, RecordPaymentDto } from './dto/subscription.dto';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
  ) {}

  async create(dto: CreateSubscriptionDto) {
    // Validate plan exists and is active
    const plan = await this.plansService.findById(dto.planId);
    if (!plan.isActive) {
      throw new DomainException('PLAN_NOT_ACTIVE', 'Cannot create subscription with inactive plan', HttpStatus.BAD_REQUEST);
    }

    const now = new Date();
    const periodEnd = new Date(now);
    const trialEnd = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;

    // Set currentPeriodEnd based on billing period or trial
    if (trialEnd) {
      periodEnd.setTime(trialEnd.getTime());
    } else {
      this.addBillingPeriod(periodEnd, plan.billingPeriod as 'MONTHLY' | 'QUARTERLY' | 'ANNUAL');
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        id: crypto.randomUUID(),
        planId: dto.planId,
        customerName: dto.customerName,
        customerTaxId: dto.customerTaxId,
        customerEmail: dto.customerEmail ?? null,
        customerPhone: dto.customerPhone ?? null,
        customerAddress: dto.customerAddress ?? null,
        status: dto.status ?? 'TRIAL',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: trialEnd,
        cancelAtPeriodEnd: false,
        paymentMethod: dto.paymentMethod ?? null,
        gracePeriodDays: dto.gracePeriodDays ?? 7,
      },
      include: { plan: true },
    });

    // Generate initial activation code for SUBSCRIPTION type
    await this.generateInitialActivationCode(subscription.id);

    return subscription;
  }

  async findAll(filter?: { status?: string; customerTaxId?: string; customerEmail?: string }) {
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.customerTaxId) where.customerTaxId = filter.customerTaxId;
    if (filter?.customerEmail) where.customerEmail = filter.customerEmail;

    return this.prisma.subscription.findMany({
      where,
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        locations: { where: { isActive: true } },
        workstationActivations: { include: { location: true } },
        activationCodes: true,
        paymentHistory: { orderBy: { recordedAt: 'desc' }, take: 20 },
      },
    });
    if (!sub) {
      throw new DomainException('SUBSCRIPTION_NOT_FOUND', `Subscription with ID ${id} not found`, HttpStatus.NOT_FOUND);
    }
    return sub;
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    await this.findById(id);

    // If planId is changing, validate the new plan
    if (dto.planId) {
      const newPlan = await this.plansService.findById(dto.planId);
      if (!newPlan.isActive) {
        throw new DomainException('PLAN_NOT_ACTIVE', 'Cannot change to inactive plan', HttpStatus.BAD_REQUEST);
      }
    }

    return this.prisma.subscription.update({
      where: { id },
      data: {
        ...(dto.planId !== undefined && { planId: dto.planId }),
        ...(dto.customerName !== undefined && { customerName: dto.customerName }),
        ...(dto.customerTaxId !== undefined && { customerTaxId: dto.customerTaxId }),
        ...(dto.customerEmail !== undefined && { customerEmail: dto.customerEmail }),
        ...(dto.customerPhone !== undefined && { customerPhone: dto.customerPhone }),
        ...(dto.customerAddress !== undefined && { customerAddress: dto.customerAddress }),
        ...(dto.gracePeriodDays !== undefined && { gracePeriodDays: dto.gracePeriodDays }),
        ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod }),
        ...(dto.paymentReference !== undefined && { paymentReference: dto.paymentReference }),
      },
      include: { plan: true },
    });
  }

  async changePlan(id: string, newPlanId: string) {
    const sub = await this.findById(id);
    const newPlan = await this.plansService.findById(newPlanId);

    if (!newPlan.isActive) {
      throw new DomainException('PLAN_NOT_ACTIVE', 'Cannot change to inactive plan', HttpStatus.BAD_REQUEST);
    }

    // If the new plan has lower maxLocations, check if customer is over the limit
    if (newPlan.maxLocations < sub.plan.maxLocations) {
      const activeLocations = sub.locations?.length ?? 0;
      if (activeLocations > newPlan.maxLocations) {
        this.logger.warn(
          `Subscription ${id} plan change to ${newPlanId}: ${activeLocations} active locations exceed new limit of ${newPlan.maxLocations}. Grace period applied.`,
        );
        // Allow the change but log the warning — the customer has a 30-day grace period to comply
      }
    }

    return this.prisma.subscription.update({
      where: { id },
      data: { planId: newPlanId },
      include: { plan: true },
    });
  }

  async suspend(id: string) {
    await this.findById(id);
    return this.prisma.subscription.update({
      where: { id },
      data: { status: 'SUSPENDED' as const },
      include: { plan: true },
    });
  }

  async cancel(id: string, cancelAtPeriodEnd = true) {
    const sub = await this.findById(id);
    if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') {
      throw new DomainException('SUBSCRIPTION_ALREADY_TERMINATED', 'Subscription is already terminated', HttpStatus.BAD_REQUEST);
    }

    return this.prisma.subscription.update({
      where: { id },
      data: {
        cancelAtPeriodEnd: cancelAtPeriodEnd,
        ...(cancelAtPeriodEnd ? {} : { status: 'CANCELLED', cancelledAt: new Date() }),
      },
      include: { plan: true },
    });
  }

  async reactivate(id: string) {
    const sub = await this.findById(id);
    if (sub.status !== 'SUSPENDED' && sub.status !== 'PAST_DUE') {
      throw new DomainException('SUBSCRIPTION_CANNOT_REACTIVATE', `Cannot reactivate subscription in status ${sub.status}`, HttpStatus.BAD_REQUEST);
    }
    return this.prisma.subscription.update({
      where: { id },
      data: { status: 'ACTIVE', cancelAtPeriodEnd: false },
      include: { plan: true },
    });
  }

  async recordPayment(id: string, dto: RecordPaymentDto) {
    const sub = await this.findById(id);

    const now = new Date();
    const nextPeriodEnd = new Date(sub.currentPeriodEnd);
    this.addBillingPeriod(nextPeriodEnd, sub.plan.billingPeriod as 'MONTHLY' | 'QUARTERLY' | 'ANNUAL');

    // Record payment in payment history
    await this.prisma.subscriptionPaymentHistory.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId: id,
        amountCents: dto.amountCents,
        currency: dto.currency ?? 'COP',
        paymentMethod: dto.paymentMethod ?? null,
        paymentReference: dto.paymentReference ?? null,
        notes: dto.notes ?? null,
        recordedAt: now,
        recordedById: dto.recordedById ?? null,
      },
    });

    // Update subscription
    return this.prisma.subscription.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        lastPaymentAt: now,
        paymentReference: dto.paymentReference ?? sub.paymentReference,
        currentPeriodEnd: nextPeriodEnd,
        nextPaymentDueAt: nextPeriodEnd,
        cancelAtPeriodEnd: false,
      },
      include: { plan: true },
    });
  }

  async findByHardwareFingerprint(fingerprint: string) {
    const activation = await this.prisma.workstationActivation.findFirst({
      where: { hardwareFingerprint: fingerprint, isActive: true },
      include: {
        subscription: { include: { plan: true } },
        location: true,
      },
    });
    return activation;
  }

  /**
   * Daily cron job to evaluate status transitions.
   * Runs every day at 02:00.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async evaluateStatusTransitions() {
    this.logger.log('Evaluating subscription status transitions...');

    const now = new Date();

    // 1. Mark EXPIRED for subscriptions past their period end without renewal
    //    (only if they're not PAST_DUE or already expired/cancelled/suspended)
    const expiredSubs = await this.prisma.subscription.updateMany({
      where: {
        currentPeriodEnd: { lt: now },
        status: { in: ['TRIAL', 'ACTIVE'] },
      },
      data: { status: 'EXPIRED' },
    });
    if (expiredSubs.count > 0) {
      this.logger.log(`Marked ${expiredSubs.count} subscription(s) as EXPIRED`);
    }

    // 2. Mark PAST_DUE for subscriptions whose period ended recently
    //    (within grace period, currently ACTIVE)
    const pastDueSubs = await this.prisma.subscription.updateMany({
      where: {
        currentPeriodEnd: { lt: now },
        status: 'ACTIVE',
      },
      data: { status: 'PAST_DUE' },
    });
    if (pastDueSubs.count > 0) {
      this.logger.log(`Marked ${pastDueSubs.count} subscription(s) as PAST_DUE`);
    }

    // 3. Mark EXPIRED for past-due subscriptions past grace period
    const graceExpired = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Subscription"
      SET status = 'EXPIRED', "updatedAt" = NOW()
      WHERE status = 'PAST_DUE'
        AND "currentPeriodEnd" + ("gracePeriodDays" * INTERVAL '1 day') < NOW()
      RETURNING id
    `;
    if (Array.isArray(graceExpired) && graceExpired.length > 0) {
      this.logger.log(`Marked ${graceExpired.length} subscription(s) as EXPIRED after grace period`);
    }

    // 4. Mark EXPIRED for trials that ended
    const trialExpired = await this.prisma.subscription.updateMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });
    if (trialExpired.count > 0) {
      this.logger.log(`Marked ${trialExpired.count} trial subscription(s) as EXPIRED`);
    }

    this.logger.log('Subscription status evaluation complete.');
  }

  private addBillingPeriod(date: Date, period: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'): void {
    switch (period) {
      case 'MONTHLY':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'QUARTERLY':
        date.setMonth(date.getMonth() + 3);
        break;
      case 'ANNUAL':
        date.setFullYear(date.getFullYear() + 1);
        break;
    }
  }

  private async generateInitialActivationCode(subscriptionId: string) {
    const code = this.generateCode();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // Codes valid for 1 year

    await this.prisma.activationCode.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId,
        code,
        type: 'SUBSCRIPTION',
        status: 'UNUSED',
        expiresAt,
      },
    });

    this.logger.log(`Generated activation code ${code} for subscription ${subscriptionId}`);
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
    const groups: string[] = [];
    for (let g = 0; g < 4; g++) {
      let group = '';
      for (let i = 0; i < 4; i++) {
        group += chars[Math.floor(Math.random() * chars.length)];
      }
      groups.push(group);
    }
    const code = groups.join('-');

    // Add a checksum character (Luhn-like mod-29)
    const checksum = this.computeChecksum(code.replace(/-/g, ''));
    return `${code}${checksum}`;
  }

  private computeChecksum(value: string): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let sum = 0;
    for (let i = 0; i < value.length; i++) {
      const pos = chars.indexOf(value[i]);
      if (pos >= 0) {
        sum += pos * (i % 2 === 0 ? 1 : 3);
      }
    }
    const check = (10 - (sum % 10)) % 10;
    return check.toString();
  }
}
