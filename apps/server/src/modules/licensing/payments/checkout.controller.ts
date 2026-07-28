import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Logger,
} from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { WompiService } from './wompi.service';
import { PlansService } from '../plans/plans.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import {
  BillingPeriod,
  DEFAULT_PLANS,
  type WompiCreatePaymentLinkRequest,
} from '@pharmacy/shared-types';
import { CreateCheckoutSessionSchema } from './dto/checkout.dto';

/**
 * Public checkout endpoints for the pharmacy SaaS licensing page.
 * No authentication required — these are the public-facing payment flow.
 */
@Controller('public/licensing/checkout')
@Public()
export class CheckoutController {
  private readonly logger = new Logger(CheckoutController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wompiService: WompiService,
    private readonly plansService: PlansService,
  ) {}

  /** List plans available for public checkout. Uses DEFAULT_PLANS as fallback. */
  @Post('plans')
  async listPublicPlans() {
    // Return DB plans first; fall back to DEFAULT_PLANS if no public plans exist yet
    const dbPlans = await this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { displayOrder: 'asc' },
    });

    if (dbPlans.length > 0) {
      return dbPlans;
    }

    // Fallback: return seed definitions (no database dependency)
    this.logger.debug('No public plans in DB, returning DEFAULT_PLANS');
    return DEFAULT_PLANS.map((p) => ({
      code: p.code,
      name: p.name,
      description: p.description,
      pricingModel: p.pricingModel,
      basePriceCents: p.basePriceCents,
      currency: p.currency,
      billingPeriod: p.billingPeriod,
      maxLocations: p.maxLocations,
      includedWorkstations: p.includedWorkstations,
      extraWorkstationPriceCents: p.extraWorkstationPriceCents,
      features: p.features,
      displayOrder: p.displayOrder,
    }));
  }

  /** Create a checkout session: builds a Wompi payment link and stores a pending record. */
  @Post('create-session')
  async createSession(@Body() raw: unknown) {
    const dto = CreateCheckoutSessionSchema.parse(raw);

    // Resolve the plan — try DB first, then DEFAULT_PLANS
    const plan = await this.resolvePlan(dto.planCode);
    const amountCents = this.calculateAmount(plan.basePriceCents, dto.billingPeriod);

    const reference = `SUB-${dto.planCode}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // Build payment link request for Wompi
    const paymentLinkRequest: WompiCreatePaymentLinkRequest = {
      name: `Suscripción ${plan.name} - ${dto.customerName}`,
      description: `Plan ${plan.code} — ${dto.billingPeriod}`,
      single_use: true,
      collect_shipping: false,
      currency: 'COP',
      amount_in_cents: amountCents,
      redirect_url: null,
    };

    let paymentLink;
    try {
      paymentLink = await this.wompiService.createPaymentLink(paymentLinkRequest);
    } catch (err) {
      this.logger.error(`Failed to create Wompi payment link: ${(err as Error).message}`);
      throw new DomainException(
        'PAYMENT_LINK_CREATION_FAILED',
        'Could not create payment link. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Store pending payment record
    const pendingId = crypto.randomUUID();
    await this.prisma.subscriptionPendingPayment.create({
      data: {
        id: pendingId,
        subscriptionId: null, // New subscription — will be set after payment
        wompiTransactionId: paymentLink.id,
        wompiReference: reference,
        purpose: 'NEW_SUBSCRIPTION',
        planId: dto.planCode,
        amountCents,
        currency: 'COP',
        customerTaxId: dto.customerTaxId,
        customerEmail: dto.customerEmail,
        customerName: dto.customerName,
        newSubscriptionData: {
          customerName: dto.customerName,
          customerTaxId: dto.customerTaxId,
          customerEmail: dto.customerEmail,
          customerPhone: dto.customerPhone ?? null,
          customerAddress: null,
          paymentMethod: 'WOMPI',
          gracePeriodDays: 7,
          trialEndsAt: null,
        },
        status: 'PENDING',
      },
    });

    const checkoutUrl = this.wompiService.buildCheckoutUrl(paymentLink.id);

    return {
      sessionId: pendingId,
      paymentLinkId: paymentLink.id,
      checkoutUrl,
      reference,
      amountCents,
      currency: 'COP',
    };
  }

  /** Poll a session's payment status. */
  @Get('session/:wompiReference')
  async pollSession(@Param('wompiReference') wompiReference: string) {
    const pending = await this.prisma.subscriptionPendingPayment.findFirst({
      where: { wompiReference },
    });

    if (!pending) {
      throw new DomainException(
        'SESSION_NOT_FOUND',
        'No pending payment found for this reference',
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      const transaction = await this.wompiService.getTransaction(
        pending.wompiTransactionId,
      );

      // Sync the status from Wompi back to our pending record
      if (transaction.status !== pending.status) {
        await this.prisma.subscriptionPendingPayment.update({
          where: { id: pending.id },
          data: { status: transaction.status },
        });
      }

      return {
        sessionId: pending.id,
        status: transaction.status,
        statusMessage: transaction.status_message,
        wompiTransactionId: transaction.id,
        reference: transaction.reference,
      };
    } catch (err) {
      this.logger.warn(
        `Could not fetch Wompi transaction ${pending.wompiTransactionId}: ${(err as Error).message}`,
      );
      return {
        sessionId: pending.id,
        status: pending.status,
        statusMessage: null,
        wompiTransactionId: pending.wompiTransactionId,
        reference: pending.wompiReference,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Resolve a plan by code: try DB, then DEFAULT_PLANS. */
  private async resolvePlan(planCode: string) {
    const dbPlan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (dbPlan) return dbPlan;

    const seedPlan = DEFAULT_PLANS.find((p) => p.code === planCode);
    if (!seedPlan) {
      throw new DomainException(
        'PLAN_NOT_FOUND',
        `Plan with code "${planCode}" not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return seedPlan;
  }

  /** Calculate amount in cents based on billing period. */
  private calculateAmount(
    basePriceCents: number,
    period: BillingPeriod,
  ): number {
    switch (period) {
      case BillingPeriod.QUARTERLY:
        // 3 months with 10% discount
        return Math.round(basePriceCents * 3 * 0.9);
      case BillingPeriod.ANNUAL:
        // 12 months with 20% discount
        return Math.round(basePriceCents * 12 * 0.8);
      case BillingPeriod.MONTHLY:
      default:
        return basePriceCents;
    }
  }
}
