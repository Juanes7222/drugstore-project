import { Controller, Post, Headers, Req, Logger, UnauthorizedException } from "@nestjs/common";
import { Public } from "@/common/decorators/public.decorator";
import { WompiService } from "./wompi.service";
import { PrismaService } from "@/infrastructure/prisma/prisma.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { ActivationsService } from "../activations/activations.service";
import {
  WompiEventType,
  WompiTransactionStatus,
  SubscriptionPaymentPurpose,
  SubscriptionStatus,
  DEFAULT_PLANS,
  type WompiWebhookEvent,
  type WompiTransactionUpdatedData,
  type CreateSubscriptionFromCheckout,
} from "@pharmacy/shared-types";

/**
 * Webhook endpoint for Wompi payment events.
 * Public — Wompi must be able to POST here without authentication.
 */
@Controller("webhooks/wompi")
@Public()
export class WompiWebhookController {
  private readonly logger = new Logger(WompiWebhookController.name);

  constructor(
    private readonly wompiService: WompiService,
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly activationsService: ActivationsService,
  ) {}

  @Post()
  async handleEvent(
    @Headers("x-event-checksum") checksumHeader: string,
    @Req() req: { body: WompiWebhookEvent<WompiTransactionUpdatedData> },
  ) {
    const event = req.body;

    this.logger.log(
      `Wompi webhook received: event=${event.event}, timestamp=${event.timestamp}`,
    );

    // Verify signature
    const isValid = this.wompiService.verifyWebhookSignature(event);
    if (!isValid) {
      this.logger.error(
        `Wompi webhook signature verification FAILED — possible fraud. Event: ${JSON.stringify(event)}`,
      );
      // Wompi expects 401 on invalid signature; throwing (not returning a
      // body) makes the HTTP status genuinely 401 so Wompi retries.
      throw new UnauthorizedException("Invalid signature");
    }

    // Await processing so a failure surfaces as a non-2xx and Wompi retries;
    // fire-and-forget left approved payments stuck PENDING forever.
    if (event.event === WompiEventType.TRANSACTION_UPDATED) {
      try {
        await this.processTransactionUpdate(event.data);
      } catch (err) {
        this.logger.error(
          `Error processing Wompi webhook: ${(err as Error).message}`,
          (err as Error).stack,
        );
        throw err;
      }
    }

    return { statusCode: 200, message: "OK" };
  }

  private async processTransactionUpdate(data: WompiTransactionUpdatedData) {
    const txn = data.transaction;

    // Find the pending payment for this transaction
    const pending = await this.prisma.subscriptionPendingPayment.findUnique({
      where: { wompiTransactionId: txn.id },
    });

    if (!pending) {
      this.logger.warn(
        `No pending payment found for Wompi transaction ${txn.id}. Possibly already processed.`,
      );
      return;
    }

    const status = txn.status as WompiTransactionStatus;

    switch (status) {
      case WompiTransactionStatus.APPROVED:
        await this.handleApprovedPayment(pending, txn);
        break;

      case WompiTransactionStatus.DECLINED:
      case WompiTransactionStatus.ERROR:
      case WompiTransactionStatus.VOIDED:
        await this.handleFailedPayment(pending.id, status.toString());
        break;

      case WompiTransactionStatus.PENDING:
      default:
        this.logger.log(
          `Wompi transaction ${txn.id} still PENDING — awaiting final resolution`,
        );
        break;
    }
  }

  private async handleApprovedPayment(
    pending: {
      id: string;
      subscriptionId: string | null;
      purpose: string;
      planId: string;
      amountCents: number;
      currency: string;
      customerTaxId: string;
      customerEmail: string;
      customerName: string;
      newSubscriptionData: unknown | null;
    },
    txn: { id: string; reference: string },
  ) {
    this.logger.log(
      `Payment approved: transaction=${txn.id}, purpose=${pending.purpose}`,
    );

    switch (pending.purpose) {
      case SubscriptionPaymentPurpose.NEW_SUBSCRIPTION: {
        // Claim the delivery atomically: only one webhook retry may win the
        // PENDING → PROCESSING transition; losers log and skip. Guards against
        // duplicate deliveries creating two subscriptions for one payment.
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.subscriptionPendingPayment.updateMany({
            where: { id: pending.id, status: "PENDING" },
            data: { status: "PROCESSING" },
          });
          if (claimed.count === 0) {
            this.logger.log(
              `Pending payment ${pending.id} already claimed by another delivery — skipping`,
            );
            return;
          }

          // subscriptionsService/activationsService use this.prisma internally
          // and accept no tx client, so they run outside the transaction; they
          // execute only after the claim, so a duplicate delivery can never
          // reach them. If one of them throws, the claim rolls back and the
          // re-thrown error makes Wompi retry the webhook.
          const subData =
            pending.newSubscriptionData as CreateSubscriptionFromCheckout | null;

          // Create the subscription
          const subscription = await this.subscriptionsService.create({
            planId: pending.planId,
            customerName: pending.customerName,
            customerTaxId: pending.customerTaxId,
            customerEmail: pending.customerEmail,
            customerPhone: subData?.customerPhone ?? null,
            customerAddress: subData?.customerAddress ?? null,
            status: SubscriptionStatus.ACTIVE,
            paymentMethod: "WOMPI",
            gracePeriodDays: subData?.gracePeriodDays ?? 7,
            trialEndsAt: subData?.trialEndsAt ?? null,
          });

          // Record the payment
          await this.subscriptionsService.recordPayment(subscription.id, {
            amountCents: pending.amountCents,
            currency: pending.currency,
            paymentMethod: "WOMPI",
            paymentReference: txn.reference,
            notes: `Wompi transaction ${txn.id}`,
            recordedById: null,
          });

          // Issue one activation code per plan-included workstation so the
          // self-service payer can onboard without admin help. subscriptionsService.create
          // already emits one initial 1-year SUBSCRIPTION code, so this leaves a
          // deliberate spare on top of the plan's included count.
          const dbPlan = await tx.plan.findUnique({
            where: { code: pending.planId },
          });
          const seedPlan = DEFAULT_PLANS.find((p) => p.code === pending.planId);
          const includedWorkstations =
            dbPlan?.includedWorkstations ?? seedPlan?.includedWorkstations ?? 1;
          await this.activationsService.generateSubscriptionCodes(
            subscription.id,
            includedWorkstations,
          );

          // Mark pending as APPROVED
          await tx.subscriptionPendingPayment.update({
            where: { id: pending.id },
            data: {
              subscriptionId: subscription.id,
              status: "APPROVED",
            },
          });

          this.logger.log(
            `New subscription created: id=${subscription.id}, pending=${pending.id}`,
          );
        });
        break;
      }

      case SubscriptionPaymentPurpose.RENEWAL:
      case SubscriptionPaymentPurpose.PLAN_UPGRADE:
      case SubscriptionPaymentPurpose.EXTRA_WORKSTATION: {
        if (!pending.subscriptionId) {
          this.logger.error(
            `Pending payment ${pending.id} has purpose=${pending.purpose} but no subscriptionId`,
          );
          return;
        }
        const subscriptionId = pending.subscriptionId;

        // Same claim-guard as NEW_SUBSCRIPTION: a webhook retry must not
        // record the same payment twice.
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.subscriptionPendingPayment.updateMany({
            where: { id: pending.id, status: "PENDING" },
            data: { status: "PROCESSING" },
          });
          if (claimed.count === 0) {
            this.logger.log(
              `Pending payment ${pending.id} already claimed by another delivery — skipping`,
            );
            return;
          }

          // recordPayment uses this.prisma internally (no tx client); it runs
          // only after the claim, so a duplicate delivery can never reach it.
          await this.subscriptionsService.recordPayment(subscriptionId, {
            amountCents: pending.amountCents,
            currency: pending.currency,
            paymentMethod: "WOMPI",
            paymentReference: txn.reference,
            notes: `Wompi transaction ${txn.id}`,
            recordedById: null,
          });

          await tx.subscriptionPendingPayment.update({
            where: { id: pending.id },
            data: { status: "APPROVED" },
          });

          this.logger.log(
            `Payment recorded for subscription ${subscriptionId}: purpose=${pending.purpose}`,
          );
        });
        break;
      }

      default:
        this.logger.warn(`Unknown payment purpose: ${pending.purpose}`);
    }
  }

  private async handleFailedPayment(pendingId: string, status: string) {
    this.logger.log(`Payment failed: pending=${pendingId}, status=${status}`);

    await this.prisma.subscriptionPendingPayment.update({
      where: { id: pendingId },
      data: { status },
    });
  }
}
