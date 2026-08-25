/**
 * SaaS-admin customer lifecycle actions — suspend, reactivate, plan change
 * and trial extension performed by a platform operator across tenants.
 * Status/transition rules stay authoritative in licensing's
 * SubscriptionsService and are delegated to rather than reimplemented; this
 * layer adds existence checks, 409 conflict mapping, idempotency
 * short-circuits and ACCESS audit entries so every cross-tenant mutation
 * stays traceable like the module's reads.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SubscriptionStatus } from '@pharmacy/database';
import { SubscriptionsService } from '@/modules/licensing/subscriptions/subscriptions.service';
import {
  SaasAdminOverviewService,
  type SaasAdminCustomerRow,
} from './saas-admin-overview.service';
import { SaasAdminAccessAuditService } from './saas-admin-access-audit.service';
import { PlanNotFoundException } from '../exceptions/plan-not-found.exception';
import { SubscriptionCannotBeReactivatedException } from '../exceptions/subscription-cannot-be-reactivated.exception';
import { SubscriptionNotFoundException } from '../exceptions/subscription-not-found.exception';
import { SubscriptionNotInTrialException } from '../exceptions/subscription-not-in-trial.exception';

/** Actor shape shared with the module's other services (a JWT User). */
type Actor = { id: string; role: string };

@Injectable()
export class SaasAdminLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly overview: SaasAdminOverviewService,
    private readonly accessAudit: SaasAdminAccessAuditService,
  ) {}

  /**
   * Suspend a subscription. Re-applying on an already-SUSPENDED row is a
   * no-op (idempotent), so webhook/operator retries cannot flip state twice.
   */
  async suspend(
    actor: Actor,
    subscriptionId: string,
    reason?: string,
    ipAddress?: string | null,
  ): Promise<SaasAdminCustomerRow> {
    const current = await this.loadSubscription(subscriptionId);

    if (current.status !== SubscriptionStatus.SUSPENDED) {
      // Licensing owns the transition semantics (existence + status write).
      await this.subscriptions.suspend(subscriptionId);
    }

    await this.auditAction(
      actor,
      subscriptionId,
      'suspend',
      reason ? { reason } : undefined,
      ipAddress,
    );
    return this.overview.getCustomer(subscriptionId);
  }

  /**
   * Reactivate back to ACTIVE. Legal only from SUSPENDED or PAST_DUE;
   * any other state is a 409, matching licensing's own guard.
   */
  async reactivate(
    actor: Actor,
    subscriptionId: string,
    ipAddress?: string | null,
  ): Promise<SaasAdminCustomerRow> {
    const current = await this.loadSubscription(subscriptionId);
    const reactivable =
      current.status === SubscriptionStatus.SUSPENDED ||
      current.status === SubscriptionStatus.PAST_DUE;
    if (!reactivable) {
      throw new SubscriptionCannotBeReactivatedException(
        subscriptionId,
        current.status,
      );
    }

    await this.subscriptions.reactivate(subscriptionId);

    await this.auditAction(actor, subscriptionId, 'reactivate', undefined, ipAddress);
    return this.overview.getCustomer(subscriptionId);
  }

  /**
   * Switch the subscription's plan by plan code. The licensing domain has
   * no proration or period-restart semantics — SubscriptionsService.changePlan
   * only swaps planId, so the current billing period is kept unchanged.
   * Changing to the current plan is an idempotent no-op.
   */
  async changePlan(
    actor: Actor,
    subscriptionId: string,
    input: { planCode: string },
    ipAddress?: string | null,
  ): Promise<SaasAdminCustomerRow> {
    const current = await this.loadSubscription(subscriptionId);

    const plan = await this.prisma.plan.findUnique({
      where: { code: input.planCode },
      select: { id: true },
    });
    if (!plan) {
      throw new PlanNotFoundException(input.planCode);
    }

    if (plan.id !== current.planId) {
      // Validates the target plan is active and applies the location-limit
      // grace-period warning inside the licensing service.
      await this.subscriptions.changePlan(subscriptionId, plan.id);
    }

    await this.auditAction(
      actor,
      subscriptionId,
      'change-plan',
      { planCode: input.planCode },
      ipAddress,
    );
    return this.overview.getCustomer(subscriptionId);
  }

  /**
   * Extend a TRIAL subscription's trialEndsAt by whole days. There is no
   * licensing method for trial extension, so this writes the Subscription
   * row directly — same platform-owned, non-RLS table the licensing cron
   * updates globally. The extension base is the LATER of now and the
   * current trial end, so extending an already-ended-but-unexpired-cron
   * trial grants full days from today instead of from the past.
   */
  async extendTrial(
    actor: Actor,
    subscriptionId: string,
    days: number,
    ipAddress?: string | null,
  ): Promise<SaasAdminCustomerRow> {
    const current = await this.loadSubscription(subscriptionId);
    if (current.status !== SubscriptionStatus.TRIAL) {
      throw new SubscriptionNotInTrialException(subscriptionId, current.status);
    }

    const now = new Date();
    const base =
      current.trialEndsAt && current.trialEndsAt > now
        ? current.trialEndsAt
        : now;
    const trialEndsAt = new Date(base);
    trialEndsAt.setDate(trialEndsAt.getDate() + days);

    // create() ties a TRIAL subscription's currentPeriodEnd to trialEndsAt,
    // and the daily licensing cron expires TRIAL rows on BOTH dates — the
    // period end must move out too or the next 02:00 run expires the row.
    const currentPeriodEnd =
      current.currentPeriodEnd > trialEndsAt
        ? current.currentPeriodEnd
        : trialEndsAt;

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { trialEndsAt, currentPeriodEnd },
    });

    await this.auditAction(
      actor,
      subscriptionId,
      'extend-trial',
      { days },
      ipAddress,
    );
    return this.overview.getCustomer(subscriptionId);
  }

  /** Existence check returning exactly the fields the transitions need. */
  private async loadSubscription(subscriptionId: string) {
    const row = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        planId: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    });
    if (!row) {
      throw new SubscriptionNotFoundException(subscriptionId);
    }
    return row;
  }

  /** ACCESS audit entry, same convention as the module's cross-tenant reads. */
  private auditAction(
    actor: Actor,
    subscriptionId: string,
    action: string,
    details?: Record<string, unknown>,
    ipAddress?: string | null,
  ): Promise<void> {
    return this.accessAudit.recordCustomerAccess({
      actorUser: actor,
      subscriptionId,
      endpoint: `/saas-admin/customers/${subscriptionId}/${action}`,
      details,
      ipAddress: ipAddress ?? null,
    });
  }
}
