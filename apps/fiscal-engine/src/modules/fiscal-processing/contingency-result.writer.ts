import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Writes the outcome of a contingency-origin fiscal document into
 * SyncInvoiceResult so the originating workstation can poll for the
 * official CUFE and DIAN XML via GET /sync/invoice-results.
 *
 * Shared by the generation processor (direct path) and the webhook
 * processor (provider path) — both entry points resolve a contingency
 * document the same way.
 */
@Injectable()
export class ContingencyResultWriter {
  private readonly logger = new Logger(ContingencyResultWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Best-effort write: a failure here must not fail the surrounding job.
   */
  async writeForDocument(fiscalDocumentId: string): Promise<void> {
    try {
      const doc = await this.prisma.fiscalDocument.findUnique({
        where: { id: fiscalDocumentId },
        select: {
          id: true,
          subscriptionId: true,
          cufeCude: true,
          signedXml: true,
          fiscalState: true,
          ptResponseCode: true,
          ptResponseMessage: true,
          saleId: true,
        },
      });

      if (!doc) return;

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
      const resultId = randomUUID();

      await this.prisma.syncInvoiceResult.upsert({
        where: { id: resultId },
        create: {
          id: resultId,
          subscriptionId: doc.subscriptionId,
          invoiceId: doc.saleId ?? fiscalDocumentId,
          workstationId,
          status: isAccepted ? 'AUTHORIZED' : 'REJECTED',
          cufeOfficial: doc.cufeCude ?? undefined,
          dianXml: doc.signedXml ?? undefined,
          rejectionReason: isAccepted
            ? null
            : (doc.ptResponseMessage ?? doc.ptResponseCode ?? 'Transmission rejected by DIAN'),
          authorizedAt: isAccepted ? new Date() : null,
        },
        update: {
          status: isAccepted ? 'AUTHORIZED' : 'REJECTED',
          cufeOfficial: doc.cufeCude ?? null,
          dianXml: doc.signedXml ?? null,
          rejectionReason: isAccepted
            ? null
            : (doc.ptResponseMessage ?? doc.ptResponseCode ?? 'Transmission rejected by DIAN'),
          authorizedAt: isAccepted ? new Date() : null,
        },
      });

      this.logger.log(
        `SyncInvoiceResult written for document ${fiscalDocumentId}: ${isAccepted ? 'AUTHORIZED' : 'REJECTED'}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to write SyncInvoiceResult for ${fiscalDocumentId}: ${(error as Error).message}`,
      );
    }
  }
}