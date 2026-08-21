import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';
import { ContingencyResultWriter } from './contingency-result.writer';

/**
 * Consumes FiscalWebhookEvent rows enqueued by apps/server's webhook intake
 * (queue `fiscal-webhook-events`). The server already verified the provider
 * signature, normalized the outcome and correlated the event to a
 * FiscalDocument — this processor only applies the result to the document
 * state machine and, for contingency-origin documents, publishes the
 * SyncInvoiceResult the workstation polls.
 */
@Processor('fiscal-webhook-events')
export class FiscalWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(FiscalWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscalTransmissionService: FiscalTransmissionService,
    private readonly contingencyResultWriter: ContingencyResultWriter,
  ) {
    super();
  }

  async process(job: Job<{ eventId: string }>): Promise<void> {
    const { eventId } = job.data;

    const event = await this.prisma.fiscalWebhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      this.logger.warn(`Webhook event ${eventId} not found — ignoring`);
      return;
    }
    if (event.status !== 'RECEIVED') {
      this.logger.warn(
        `Webhook event ${eventId} already processed (${event.status}) — ignoring`,
      );
      return;
    }
    if (!event.fiscalDocumentId || event.outcome === null) {
      await this.markFailed(eventId, 'Event has no correlated document or outcome');
      return;
    }

    const document = await this.prisma.fiscalDocument.findUnique({
      where: { id: event.fiscalDocumentId },
      select: {
        id: true,
        fiscalState: true,
        contingencyReason: true,
      },
    });

    if (!document) {
      await this.markFailed(
        eventId,
        `Document ${event.fiscalDocumentId} not found`,
      );
      return;
    }

    const isTerminal =
      document.fiscalState === 'VALIDATED' || document.fiscalState === 'REJECTED';
    if (isTerminal) {
      // Provider retransmissions after the outcome was already applied —
      // nothing to do, the event is a duplicate or a late replay.
      await this.prisma.fiscalWebhookEvent.update({
        where: { id: eventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return;
    }

    if (event.outcome === 'OTHER') {
      // Provider-internal state (queued, validating...) — keep the document
      // in IN_TRANSMISSION and acknowledge the event.
      await this.prisma.fiscalWebhookEvent.update({
        where: { id: eventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return;
    }

    const isValid = event.outcome === 'VALIDATED';

    await this.fiscalTransmissionService.applyTransmissionResult(
      event.fiscalDocumentId,
      {
        isValid,
        xmlDocumentKey: event.cufe,
        signedXml: event.signedXml,
        statusCode: event.responseCode,
        statusMessage: event.responseMessage,
      },
    );

    if (document.contingencyReason !== null) {
      await this.contingencyResultWriter.writeForDocument(event.fiscalDocumentId);
    }

    await this.prisma.fiscalWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    this.logger.log(
      `Webhook event ${eventId} applied: document ${event.fiscalDocumentId} -> ${event.outcome}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ eventId: string }>, error: Error): void {
    this.logger.error(
      `Job ${job.id} for webhook event ${job.data.eventId} failed: ${error.message}`,
    );
  }

  private async markFailed(eventId: string, reason: string): Promise<void> {
    await this.prisma.fiscalWebhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        processingError: reason,
        processedAt: new Date(),
      },
    });
    this.logger.warn(`Webhook event ${eventId} marked FAILED: ${reason}`);
  }
}