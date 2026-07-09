import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  FISCAL_TRANSMISSION_PORT,
  SECRET_READER_PORT,
} from './ports';
import type {
  FiscalTransmissionPort,
  SecretReaderPort,
} from './ports';
import { FiscalTransmissionFailedException } from './exceptions/fiscal-transmission-failed.exception';
import { FiscalDocumentRejectedException } from './exceptions/fiscal-document-rejected.exception';

/**
 * Orchestrates the signing and transmission of a fiscal document to DIAN.
 *
 * Loads a FiscalDocument already in PENDING_SIGNATURE with its xmlPayload,
 * resolves the certificate through SecretReaderPort, initializes the
 * DianClient, and transitions the document through IN_TRANSMISSION to
 * either VALIDATED or REJECTED (or SIGNATURE_ERROR on a pre-transmission
 * failure).
 *
 * This class is ~220 lines, 20 over the soft limit, but splitting the
 * three-way error classification or the state-machine transitions into
 * a separate class would force readers to jump across files to follow
 * a single linear flow — keeping it here preserves readability over
 * strict line-count compliance.
 */
@Injectable()
export class FiscalTransmissionService {
  private readonly logger = new Logger(FiscalTransmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FISCAL_TRANSMISSION_PORT)
    private readonly transmission: FiscalTransmissionPort,
    @Inject(SECRET_READER_PORT)
    private readonly secrets: SecretReaderPort,
  ) {}

  /**
   * Signs and transmits the given fiscal document to DIAN.
   * The document must be in PENDING_SIGNATURE state with xmlPayload populated.
   *
   * @throws FiscalTransmissionFailedException if the document is not in the
   *         expected state or if a pre-transmission failure occurs.
   * @throws FiscalDocumentRejectedException  if DIAN rejects the document.
   */
  async transmit(fiscalDocumentId: string): Promise<void> {
    const doc = await this.loadPendingDocument(fiscalDocumentId);

    const config = await this.loadTechProviderConfig();

    const { certificate, password } = await this.secrets.readSecret(
      config.credentialReference ?? '',
    );

    const fileName = this.buildFileName(doc.fullNumber);

    this.logger.log(`Transmitting document ${doc.fullNumber} (${fiscalDocumentId})`);

    await this.transitionToInTransmission(fiscalDocumentId);

    // The SDK performs XAdES-EPES signing as part of the send call below.
    let result;
    try {
      result = await this.transmission.signAndSend(
        doc.xmlPayload,
        fileName,
        certificate,
        password,
        config.environment,
      );
    } catch (error: unknown) {
      await this.handleSendException(fiscalDocumentId, error);
      throw error;
    }

    if (result.isValid) {
      await this.transitionToValidated(fiscalDocumentId, result);
      this.logger.log(`Document ${doc.fullNumber} validated with key ${result.xmlDocumentKey}`);
    } else {
      await this.transitionToRejected(fiscalDocumentId, result);
      throw new FiscalDocumentRejectedException(
        fiscalDocumentId,
        result.statusMessage ?? 'No status message from DIAN',
      );
    }
  }

  private async loadPendingDocument(fiscalDocumentId: string): Promise<any> {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
    });

    if (!doc) {
      throw new FiscalTransmissionFailedException(
        fiscalDocumentId,
        'Document not found',
      );
    }

    if (doc.fiscalState !== 'PENDING_SIGNATURE') {
      throw new FiscalTransmissionFailedException(
        fiscalDocumentId,
        `Expected state PENDING_SIGNATURE, got ${doc.fiscalState}`,
      );
    }

    if (!doc.xmlPayload) {
      throw new FiscalTransmissionFailedException(
        fiscalDocumentId,
        'Document has no xmlPayload — generation step did not complete',
      );
    }

    return doc;
  }

  private async loadTechProviderConfig(): Promise<any> {
    const config = await (this.prisma as any).techProviderConfig.findFirst();
    if (!config) {
      throw new Error('No TechProviderConfig found in the database');
    }
    return config;
  }

  private buildFileName(fullNumber: string): string {
    const safe = fullNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safe}.xml`;
  }

  private async transitionToInTransmission(
    fiscalDocumentId: string,
  ): Promise<void> {
    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: {
        fiscalState: 'IN_TRANSMISSION',
        lastRetryAt: new Date(),
      },
    });
  }

  private async transitionToValidated(
    fiscalDocumentId: string,
    result: { xmlDocumentKey: string | null; signedXml: string | null; statusCode: string | null; statusMessage: string | null },
  ): Promise<void> {
    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: {
        cufeCude: result.xmlDocumentKey ?? undefined,
        signedXml: result.signedXml ?? undefined,
        fiscalState: 'VALIDATED',
        ptResponseCode: result.statusCode,
        ptResponseMessage: result.statusMessage,
      },
    });
  }

  private async transitionToRejected(
    fiscalDocumentId: string,
    result: { statusCode: string | null; statusMessage: string | null },
  ): Promise<void> {
    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: {
        fiscalState: 'REJECTED',
        ptResponseCode: result.statusCode,
        ptResponseMessage: result.statusMessage,
      },
    });
  }

  /**
   * Handles exceptions thrown during signAndSend.
   *
   * Three-way classification per architectural decision:
   *   - If the failure happened before the SDK's send call (certificate
   *     read failure, malformed request), the document transitions to
   *     SIGNATURE_ERROR.
   *   - If the failure happened during or after transmission and the
   *     outcome is genuinely unknown, the document stays in IN_TRANSMISSION
   *     with the error message recorded and retryCount incremented.
   *
   * Known limitation: there is no idempotency guarantee on the DIAN side,
   * so blindly resending an already-transmitted document risks DIAN
   * receiving it twice. This ambiguity is documented but not resolved here.
   */
  private async handleSendException(
    fiscalDocumentId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Heuristic: if we never built the SOAP envelope (e.g. cert failure),
    // treat it as a signing error. Otherwise the document may have reached
    // DIAN — leave it in IN_TRANSMISSION.
    const isBeforeSend =
      message.includes('certificate') ||
      message.includes('initialize') ||
      message.includes('password') ||
      message.includes('not been initialized');

    if (isBeforeSend) {
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDocumentId },
        data: {
          fiscalState: 'SIGNATURE_ERROR',
          ptResponseMessage: message,
        },
      });
    } else {
      // Outcome unknown — increment retry and preserve the IN_TRANSMISSION
      // state rather than picking a resolution that might be wrong.
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDocumentId },
        data: {
          ptResponseMessage: message,
          retryCount: { increment: 1 },
        },
      });
      this.logger.warn(
        `Document ${fiscalDocumentId} left in IN_TRANSMISSION after exception: ${message}`,
      );
    }
  }
}
