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
import { TechProviderConfigNotFoundException } from './exceptions/tech-provider-config-not-found.exception';
import { DIAN_ENVIRONMENT_INVALID_ERROR_CODE } from './exceptions/invalid-dian-environment.exception';
import {
  TransmissionRouteResolver,
  type TransmissionRoute,
} from './transmission-route.resolver';
import type { FiscalProvider } from '@pharmacy/database';
import { DomainException } from '../../common/exceptions/domain.exception';

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
    private readonly routeResolver: TransmissionRouteResolver,
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

    const config = await this.loadTechProviderConfig(doc.subscriptionId);

    // The plan's billingMethod decides the transmission party: PROVIDER uses
    // our server-side credential reference, CERTIFICATE/legacy uses the
    // tenant's own uploaded certificate.
    const route = await this.routeResolver.resolve(doc.subscriptionId);
    this.logger.log(
      `Transmission route for ${fiscalDocumentId}: ${route} (subscription ${doc.subscriptionId})`,
    );

    if (route === 'PROVIDER' && !config.credentialReference) {
      throw new FiscalTransmissionFailedException(
        fiscalDocumentId,
        'plan uses provider transmission but TechProviderConfig has no credentialReference configured server-side',
      );
    }

    const { certificate, password } = await this.secrets.readSecret(
      doc.subscriptionId,
      route === 'PROVIDER' ? config.credentialReference ?? '' : '',
    );

    const fileName = this.buildFileName(doc.fullNumber);

    this.logger.log(`Transmitting document ${doc.fullNumber} (${fiscalDocumentId})`);

    // Atomic claim: only one worker can move the document out of
    // PENDING_SIGNATURE. Without this, a retry and a manual re-trigger could
    // both pass loadPendingDocument and transmit the same document twice —
    // DIAN offers no idempotency for a re-sent document. The claim also
    // stamps the transmitting party for webhook correlation.
    await this.claimDocument(fiscalDocumentId, route, config.providerType);

    // The adapter performs XAdES-EPES signing as part of the send call below.
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
      await this.applyTransmissionResult(fiscalDocumentId, {
        isValid: true,
        xmlDocumentKey: result.xmlDocumentKey,
        signedXml: result.signedXml,
        statusCode: result.statusCode,
        statusMessage: result.statusMessage,
      });
      this.logger.log(`Document ${doc.fullNumber} validated with key ${result.xmlDocumentKey}`);
    } else {
      await this.applyTransmissionResult(fiscalDocumentId, {
        isValid: false,
        xmlDocumentKey: null,
        signedXml: null,
        statusCode: result.statusCode,
        statusMessage: result.statusMessage,
      });
      throw new FiscalDocumentRejectedException(
        fiscalDocumentId,
        result.statusMessage ?? 'No status message from DIAN',
      );
    }
  }

  /**
   * Applies a transmission outcome to a document: VALIDATED stores the
   * official CUFE, the signed XML and the provider's track id; REJECTED
   * records the refusal. Shared by the direct SOAP path and the webhook
   * processor so both entry points transition documents identically.
   */
  async applyTransmissionResult(
    fiscalDocumentId: string,
    result: {
      isValid: boolean;
      xmlDocumentKey: string | null;
      signedXml: string | null;
      statusCode: string | null;
      statusMessage: string | null;
    },
  ): Promise<void> {
    if (result.isValid) {
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDocumentId },
        data: {
          cufeCude: result.xmlDocumentKey ?? undefined,
          signedXml: result.signedXml ?? undefined,
          fiscalState: 'VALIDATED',
          // For the direct path the DIAN track id is the external reference
          // that future webhook/status flows correlate on.
          providerTrackId: result.xmlDocumentKey ?? undefined,
          ptResponseCode: result.statusCode,
          ptResponseMessage: result.statusMessage,
        },
      });
      return;
    }

    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: {
        fiscalState: 'REJECTED',
        ptResponseCode: result.statusCode,
        ptResponseMessage: result.statusMessage,
      },
    });
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

  private async loadTechProviderConfig(subscriptionId: string): Promise<any> {
    const config = await this.prisma.techProviderConfig.findFirst({
      where: { subscriptionId },
    });
    if (!config) {
      throw new TechProviderConfigNotFoundException(subscriptionId);
    }
    return config;
  }

  private buildFileName(fullNumber: string): string {
    const safe = fullNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safe}.xml`;
  }

  /**
   * Atomically claims a PENDING_SIGNATURE document for transmission.
   *
   * The conditional updateMany is the concurrency guard: if another worker
   * (or a manual re-trigger) already claimed the document, the update
   * affects zero rows and this worker aborts instead of double-transmitting.
   * The claim also records the transmitting party for webhook correlation:
   * the configured provider type for PROVIDER routes, DIAN_DIRECT otherwise.
   */
  private async claimDocument(
    fiscalDocumentId: string,
    route: TransmissionRoute,
    configuredProviderType: string | null,
  ): Promise<void> {
    const claimed = await this.prisma.fiscalDocument.updateMany({
      where: { id: fiscalDocumentId, fiscalState: 'PENDING_SIGNATURE' },
      data: {
        fiscalState: 'IN_TRANSMISSION',
        providerType:
          route === 'PROVIDER'
            ? ((configuredProviderType ?? 'DIAN_DIRECT') as FiscalProvider)
            : 'DIAN_DIRECT',
        lastRetryAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new FiscalTransmissionFailedException(
        fiscalDocumentId,
        'Document is not in PENDING_SIGNATURE state - another worker may have claimed it',
      );
    }
  }

  /**
   * Handles exceptions thrown during signAndSend.
   *
   * Classification order, most reliable signal first:
   *   - Structured: a DomainException whose errorCode marks a deterministic
   *     pre-transmission failure (e.g. DIAN_ENVIRONMENT_INVALID — endpoint
   *     resolution happens before any HTTP traffic). Transitions the
   *     document to SIGNATURE_ERROR; retrying cannot change the outcome.
   *   - Heuristic: if the failure message suggests the SOAP envelope was
   *     never built (certificate read failure, malformed request), treat it
   *     as a signing error, also SIGNATURE_ERROR.
   *   - Otherwise the failure happened during or after transmission and
   *     the outcome is genuinely unknown: the document stays in
   *     IN_TRANSMISSION with the error message recorded and retryCount
   *     incremented.
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

    if (this.isDeterministicPreSendFailure(error)) {
      await this.markSignatureError(fiscalDocumentId, message);
      return;
    }

    // Fallback heuristic for untyped errors: if we never built the SOAP
    // envelope (e.g. cert failure), treat it as a signing error. Otherwise
    // the document may have reached DIAN — leave it in IN_TRANSMISSION.
    const isBeforeSend =
      message.includes('certificate') ||
      message.includes('initialize') ||
      message.includes('password') ||
      message.includes('not been initialized');

    if (isBeforeSend) {
      await this.markSignatureError(fiscalDocumentId, message);
      return;
    }

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

  /** Error codes whose failures are deterministic and occur before any HTTP traffic, so no retry can succeed. */
  private static readonly DETERMINISTIC_PRE_SEND_ERROR_CODES: readonly string[] = [
    DIAN_ENVIRONMENT_INVALID_ERROR_CODE,
  ];

  /**
   * Matches by stable errorCode on structured exceptions, never by message
   * text: an InvalidDianEnvironmentException describes a configuration
   * fault fixed before the request exists, so it must not consume retries
   * or strand the document in IN_TRANSMISSION awaiting manual intervention.
   */
  private isDeterministicPreSendFailure(error: unknown): boolean {
    return (
      error instanceof DomainException &&
      FiscalTransmissionService.DETERMINISTIC_PRE_SEND_ERROR_CODES.includes(
        error.errorCode,
      )
    );
  }

  /**
   * Terminal pre-send failure transition — the same one used for
   * certificate-load failures. The document never reached DIAN, so
   * SIGNATURE_ERROR (not REJECTED, which implies DIAN saw and refused it)
   * records that the failure needs a config/fix + re-trigger, not a retry.
   */
  private async markSignatureError(
    fiscalDocumentId: string,
    message: string,
  ): Promise<void> {
    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: {
        fiscalState: 'SIGNATURE_ERROR',
        ptResponseMessage: message,
      },
    });
  }
}
