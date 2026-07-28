import { Controller, Post, Headers, Req, Logger } from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { WompiService } from './wompi.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  WompiEventType,
  WompiTransactionStatus,
  SubscriptionPaymentPurpose,
  SubscriptionStatus,
  type WompiWebhookEvent,
  type WompiTransactionUpdatedData,
  type CreateSubscriptionFromCheckout,
} from '@pharmacy/shared-types';

/**
 * Webhook endpoint for Wompi payment events.
 * Public — Wompi must be able to POST here without authentication.
 */
@Controller('webhooks/wompi')
@Public()
export class WompiWebhookController {
  private readonly logger = new Logger(WompiWebhookController.name);

  constructor(
    private readonly wompiService: WompiService,
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  async handleEvent(
    @Headers('x-event-checksum') checksumHeader: string,
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
      // Wompi expects 401 on invalid signature
      return { statusCode: 401, message: 'Invalid signature' };
    }

    // Always ACK immediately (Wompi retries on non-200)
    // Process asynchronously by not awaiting — NestJS handles the lifecycle
    if (event.event === WompiEventType.TRANSACTION_UPDATED) {
      this.processTransactionUpdate(event.data).catch((err) => {
        this.logger.error(`Error processing Wompi webhook: ${err.message}`, err.stack);
      });
    }

    return { statusCode: 200, message: 'OK' };
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
    this.logger.log(`Payment approved: transaction=${txn.id}, purpose=${pending.purpose}`);

    switch (pending.purpose) {
      case SubscriptionPaymentPurpose.NEW_SUBSCRIPTION: {
        const subData = pending.newSubscriptionData as CreateSubscriptionFromCheckout | null;

        // Create the subscription
        const subscription = await this.subscriptionsService.create({
          planId: pending.planId,
          customerName: pending.customerName,
          customerTaxId: pending.customerTaxId,
          customerEmail: pending.customerEmail,
          customerPhone: subData?.customerPhone ?? null,
          customerAddress: subData?.customerAddress ?? null,
          status: SubscriptionStatus.ACTIVE,
          paymentMethod: 'WOMPI',
          gracePeriodDays: subData?.gracePeriodDays ?? 7,
          trialEndsAt: subData?.trialEndsAt ?? null,
        });

        // Record the payment
        await this.subscriptionsService.recordPayment(subscription.id, {
          amountCents: pending.amountCents,
          currency: pending.currency,
          paymentMethod: 'WOMPI',
          paymentReference: txn.reference,
          notes: `Wompi transaction ${txn.id}`,
          recordedById: null,
        });

        // Mark pending as APPROVED
        await this.prisma.subscriptionPendingPayment.update({
          where: { id: pending.id },
          data: {
            subscriptionId: subscription.id,
            status: 'APPROVED',
          },
        });

        this.logger.log(
          `New subscription created: id=${subscription.id}, pending=${pending.id}`,
        );
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

        await this.subscriptionsService.recordPayment(pending.subscriptionId, {
          amountCents: pending.amountCents,
          currency: pending.currency,
          paymentMethod: 'WOMPI',
          paymentReference: txn.reference,
          notes: `Wompi transaction ${txn.id}`,
          recordedById: null,
        });

        await this.prisma.subscriptionPendingPayment.update({
          where: { id: pending.id },
          data: { status: 'APPROVED' },
        });

        this.logger.log(
          `Payment recorded for subscription ${pending.subscriptionId}: purpose=${pending.purpose}`,
        );
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
