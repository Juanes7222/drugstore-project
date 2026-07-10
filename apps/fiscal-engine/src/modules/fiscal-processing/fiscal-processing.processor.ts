import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';

/**
 * Generation and transmission are two services but one job — splitting them
 * across two queue round-trips would only add latency without adding safety.
 *
 * After transmission, if the document originated from an offline contingency
 * invoice (fiscalState CONTINGENCY or PENDING_TRANSMISSION from a
 * contingency-origin document), the result is written to SyncInvoiceResult
 * so the workstation can poll for the official CUFE and DIAN XML.
 */
@Processor('fiscal-documents')
export class FiscalProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(FiscalProcessingProcessor.name);

  constructor(
    private readonly fiscalDocumentsService: FiscalDocumentsService,
    private readonly fiscalTransmissionService: FiscalTransmissionService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<{ fiscalDocumentId: string }>): Promise<void> {
    const { fiscalDocumentId } = job.data;
    this.logger.log(`Processing job ${job.id} for document ${fiscalDocumentId}`);

    // Determine if this document originated from offline contingency
    // by reading its initial state before generation changes it.
    const initialDoc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
      select: {
        fiscalState: true,
        contingencyReason: true,
        saleId: true,
      },
    });
    const isContingencyDocument = initialDoc?.contingencyReason !== null;

    // Step 1: Generate UBL XML and CUFE
    try {
      await this.fiscalDocumentsService.generate(fiscalDocumentId);
      this.logger.log(`Successfully generated document ${fiscalDocumentId}`);
    } catch (error) {
      this.logger.error(
        `Failed to generate document ${fiscalDocumentId}: ${(error as Error).message}`,
      );
      await this.transitionToErrorState(fiscalDocumentId);
      throw error;
    }

    // Step 2: Sign and transmit to DIAN (continues in the same job)
    try {
      await this.fiscalTransmissionService.transmit(fiscalDocumentId);
      this.logger.log(`Successfully transmitted document ${fiscalDocumentId}`);
    } catch (error) {
      this.logger.error(
        `Failed to transmit document ${fiscalDocumentId}: ${(error as Error).message}`,
      );
      // The transmission service has already updated the document state;
      // the job is marked failed so BullMQ can retry if configured.
      throw error;
    }

    // Step 3: If this was a contingency document, write the result to
    // SyncInvoiceResult so the workstation can poll for the official data.
    if (isContingencyDocument) {
      await this.writeContingencyResult(fiscalDocumentId);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ fiscalDocumentId: string }>, error: Error): void {
    const id = job.data.fiscalDocumentId;
    this.logger.error(
      `Job ${job.id} for document ${id} failed permanently: ${error.message}`,
    );
  }

  /**
   * Writes the DIAN transmission result for a contingency-origin document
   * into the SyncInvoiceResult table so the originating workstation can
   * retrieve it via GET /sync/invoice-results.
   *
   * This runs after a successful transmission. For a failed transmission
   * (which throws), the job is retried by BullMQ; permanent failure is
   * handled separately (e.g. by an admin retry or manual intervention).
   */
  private async writeContingencyResult(fiscalDocumentId: string): Promise<void> {
    try {
      const doc = await this.prisma.fiscalDocument.findUnique({
        where: { id: fiscalDocumentId },
        select: {
          id: true,
          cufeCude: true,
          signedXml: true,
          fiscalState: true,
          ptResponseCode: true,
          ptResponseMessage: true,
          saleId: true,
        },
      });

      if (!doc) return;

      // Find the workstationId via the sale or use a placeholder
      // The sale's sourceWorkstationId is the originating POS workstation.
      let workstationId: string | null = null;
      if (doc.saleId) {
        const sale = await this.prisma.sale.findUnique({
          where: { id: doc.saleId },
          select: { sourceWorkstationId: true },
        });
        workstationId = sale?.sourceWorkstationId ?? null;
      }

      if (!workstationId) {
        this.logger.warn(
          `Cannot write SyncInvoiceResult for document ${fiscalDocumentId}: no workstation found`,
        );
        return;
      }

      const isAccepted = doc.fiscalState === 'VALIDATED';
      const resultId = crypto.randomUUID();

      await this.prisma.syncInvoiceResult.upsert({
        where: { id: resultId },
        create: {
          id: resultId,
          // invoiceId is the FiscalDocument id — the workstation correlates
          // by looking up the CUFE or by the saleId through its local records.
          invoiceId: doc.saleId ?? fiscalDocumentId,
          workstationId,
          status: isAccepted ? 'AUTHORIZED' : 'REJECTED',
          cufeOfficial: doc.cufeCude ?? undefined,
          dianXml: doc.signedXml ?? undefined,
          rejectionReason: isAccepted ? null : (doc.ptResponseMessage ?? doc.ptResponseCode ?? 'Transmission rejected by DIAN'),
          authorizedAt: isAccepted ? new Date() : null,
        },
        update: {
          status: isAccepted ? 'AUTHORIZED' : 'REJECTED',
          cufeOfficial: doc.cufeCude ?? null,
          dianXml: doc.signedXml ?? null,
          rejectionReason: isAccepted ? null : (doc.ptResponseMessage ?? doc.ptResponseCode ?? 'Transmission rejected by DIAN'),
          authorizedAt: isAccepted ? new Date() : null,
        },
      });

      this.logger.log(
        `SyncInvoiceResult written for contingency document ${fiscalDocumentId}: ${isAccepted ? 'AUTHORIZED' : 'REJECTED'}`,
      );
    } catch (error) {
      // Best-effort: failing to write the result should not break the job.
      this.logger.error(
        `Failed to write SyncInvoiceResult for ${fiscalDocumentId}: ${(error as Error).message}`,
      );
    }
  }

  private async transitionToErrorState(fiscalDocumentId: string): Promise<void> {
    try {
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDocumentId },
        data: { fiscalState: 'GENERATION_ERROR' },
      });
    } catch (updateError) {
      this.logger.error(
        `Failed to update error state for document ${fiscalDocumentId}: ` +
          `${(updateError as Error).message}`,
      );
    }
  }
}
