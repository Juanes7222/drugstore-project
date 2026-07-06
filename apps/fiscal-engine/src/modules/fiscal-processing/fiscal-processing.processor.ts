import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';

/**
 * Generation and transmission are two services but one job — splitting them
 * across two queue round-trips would only add latency without adding safety.
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
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ fiscalDocumentId: string }>, error: Error): void {
    const id = job.data.fiscalDocumentId;
    this.logger.error(
      `Job ${job.id} for document ${id} failed permanently: ${error.message}`,
    );
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
