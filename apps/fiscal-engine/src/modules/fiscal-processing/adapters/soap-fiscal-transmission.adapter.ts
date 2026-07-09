import { Injectable, Logger } from '@nestjs/common';
import { FiscalTransmissionPort } from '../ports/fiscal-transmission.port';
import { SendResult, StatusResult } from '../ports/transmission-results.type';
import { CertificateLoader, CertificateData } from '../signing/certificate.loader';
import { XadesSigner } from '../signing/xades-signer';
import { SoapSigner } from '../soap/soap-signer';
import { SoapEnvelopeBuilder } from '../soap/soap-envelope.builder';
import { DianHttpClient } from '../soap/dian-http-client';
import {
  DIAN_ENDPOINTS,
  SOAP_ACTION_SEND_BILL_SYNC,
  SOAP_ACTION_GET_STATUS,
  SOAP_ACTION_GET_NUMBERING_RANGE,
} from '../signing/dian-constants';

/**
 * Adapter that implements FiscalTransmissionPort using pure TypeScript:
 *   - XAdES-EPES signing via xml-crypto + node-forge
 *   - WS-Security SOAP signing via xml-crypto ExclusiveCanonicalization
 *   - HTTP transport via Node 22 built-in fetch
 *
 * This replaces the previous DianSdkFiscalTransmissionAdapter which
 * depended on the unpublished dian-sdk-node package.
 *
 * Architecture note: the three operations (signAndSend, getNumberingRange,
 * checkStatus) each initialise the certificate from the raw buffer on
 * every call. This is deliberate — the FiscalTransmissionPort interface
 * does not expose a session or reusable client, so each call is fully
 * self-contained. If performance becomes a concern, add an in-memory
 * certificate cache keyed by the buffer's SHA-256.
 */
@Injectable()
export class SoapFiscalTransmissionAdapter implements FiscalTransmissionPort {
  private readonly logger = new Logger(SoapFiscalTransmissionAdapter.name);

  private readonly certificateLoader = new CertificateLoader();
  private readonly xadesSigner = new XadesSigner();
  private readonly soapSigner = new SoapSigner();
  private readonly envelopeBuilder = new SoapEnvelopeBuilder();
  private readonly httpClient = new DianHttpClient();

  // ── FiscalTransmissionPort implementation ─────────────────────────

  async signAndSend(
    unsignedXml: string,
    fileName: string,
    certificate: Buffer,
    certPassword: string,
    environment: string,
  ): Promise<SendResult> {
    const certData = await this.certificateLoader.loadFromBuffer(certificate, certPassword);

    // Step 1: XAdES-EPES sign the UBL XML
    const signedXml = this.xadesSigner.sign(unsignedXml, certData);

    // Step 2: Base64-encode the signed XML for the SOAP payload
    const contentFile = Buffer.from(signedXml, 'utf-8').toString('base64');

    // Step 3: Build the unsigned SOAP envelope
    const unsignedSoap = this.envelopeBuilder.buildSendBillSync(fileName, contentFile);

    // Step 4: Apply WS-Security
    const url = this.getEndpoint(environment);
    const signedSoap = this.soapSigner.sign(
      unsignedSoap,
      certData,
      SOAP_ACTION_SEND_BILL_SYNC,
      url,
    );

    // Step 5: Transmit
    const result = await this.httpClient.sendAndGetResult(
      signedSoap,
      url,
      SOAP_ACTION_SEND_BILL_SYNC,
      'SendBillSyncResponse',
    );

    return this.parseSendResult(result);
  }

  async getNumberingRange(
    certificate: Buffer,
    certPassword: string,
    environment: string,
    resolutionNumber: string,
  ): Promise<{ clTec: string }> {
    const certData = await this.certificateLoader.loadFromBuffer(certificate, certPassword);

    const unsignedSoap = this.envelopeBuilder.buildGetNumberingRange(resolutionNumber);

    const url = this.getEndpoint(environment);
    const signedSoap = this.soapSigner.sign(
      unsignedSoap,
      certData,
      SOAP_ACTION_GET_NUMBERING_RANGE,
      url,
    );

    const result = await this.httpClient.sendAndGetResult(
      signedSoap,
      url,
      SOAP_ACTION_GET_NUMBERING_RANGE,
      'GetNumberingRangeResponse',
    );

    const clTec: string = String(result?.ClTec ?? result?.clTec ?? '');

    if (!clTec) {
      this.logger.warn(
        `GetNumberingRange returned empty ClTec for resolution ${resolutionNumber}`,
      );
    }

    return { clTec };
  }

  async checkStatus(
    trackId: string,
    certificate: Buffer,
    certPassword: string,
    environment: string,
  ): Promise<StatusResult> {
    const certData = await this.certificateLoader.loadFromBuffer(certificate, certPassword);

    const unsignedSoap = this.envelopeBuilder.buildGetStatus(trackId);

    const url = this.getEndpoint(environment);
    const signedSoap = this.soapSigner.sign(
      unsignedSoap,
      certData,
      SOAP_ACTION_GET_STATUS,
      url,
    );

    const result = await this.httpClient.sendAndGetResult(
      signedSoap,
      url,
      SOAP_ACTION_GET_STATUS,
      'GetStatusResponse',
    );

    return this.parseStatusResult(result);
  }

  // ── Private helpers ───────────────────────────────────────────────

  private getEndpoint(environment: string): string {
    return DIAN_ENDPOINTS[environment] ?? DIAN_ENDPOINTS['2'];
  }

  private parseSendResult(result: Record<string, unknown> | null): SendResult {
    return {
      isValid: this.isTrue(result?.IsValid) ?? this.isTrue(result?.isValid) ?? false,
      xmlDocumentKey: this.asStringOrNull(result?.XmlDocumentKey ?? result?.xmlDocumentKey),
      signedXml: this.asStringOrNull(result?.XmlDocument ?? result?.xmlDocument),
      statusMessage: this.asStringOrNull(
        result?.StatusDescription ?? result?.StatusMessage ?? result?.statusDescription ?? result?.statusMessage,
      ),
      statusCode: this.asStringOrNull(result?.StatusCode ?? result?.statusCode),
    };
  }

  private parseStatusResult(result: Record<string, unknown> | null): StatusResult {
    return {
      isValid: this.isTrue(result?.IsValid) ?? this.isTrue(result?.isValid) ?? false,
      statusCode: this.asStringOrNull(result?.StatusCode ?? result?.statusCode),
      statusDescription: this.asStringOrNull(
        result?.StatusDescription ?? result?.StatusMessage ?? result?.statusDescription ?? result?.statusMessage,
      ),
    };
  }

  private isTrue(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  private asStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return String(value);
  }
}
