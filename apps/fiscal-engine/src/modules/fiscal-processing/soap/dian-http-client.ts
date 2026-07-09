import { XMLParser } from 'fast-xml-parser';
import { Injectable, Logger } from '@nestjs/common';
import { NS_SOAP_ENVELOPE } from '../signing/dian-constants';

/**
 * HTTP client for DIAN SOAP web service calls.
 *
 * Uses Node.js 22's built-in fetch for HTTP transport and
 * fast-xml-parser for parsing the SOAP XML response.
 *
 * The response is parsed with namespaces stripped so the caller
 * can access e.g. `response.Envelope.Body.SendBillSyncResponse
 * .SendBillSyncResult` without namespace prefixes.
 */
@Injectable()
export class DianHttpClient {
  private readonly logger = new Logger(DianHttpClient.name);

  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    removeNSPrefix: true,
  });

  /**
   * Sends a signed SOAP envelope to DIAN and returns the parsed
   * response body.
   *
   * @param signedSoap   The complete SOAP envelope XML string with
   *                     WS-Security headers already applied.
   * @param url          DIAN endpoint URL.
   * @param soapAction   The SOAP action URI.
   * @returns            The parsed response object (namespace-stripped).
   */
  async send(
    signedSoap: string,
    url: string,
    soapAction: string,
  ): Promise<Record<string, unknown>> {
    this.logger.debug(`POST ${url} action=${soapAction}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        SOAPAction: soapAction,
      },
      body: signedSoap,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `DIAN HTTP ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      );
    }

    const responseText = await response.text();
    const parsed = this.xmlParser.parse(responseText) as Record<string, unknown>;

    // Navigate through the response envelope
    const envelope = parsed?.['Envelope'] as Record<string, unknown> | undefined;
    const body = envelope?.['Body'] as Record<string, unknown> | undefined;

    if (!body) {
      this.logger.warn(`Unexpected DIAN response structure: ${responseText.slice(0, 300)}`);
      return parsed;
    }

    return body;
  }

  /**
   * Sends a signed SOAP envelope for SendBillSync and returns the
   * operation result payload specifically.
   */
  async sendAndGetResult(
    signedSoap: string,
    url: string,
    soapAction: string,
    resultKey: string,
  ): Promise<Record<string, unknown> | null> {
    const body = await this.send(signedSoap, url, soapAction);

    // fast-xml-parser with removeNSPrefix=true strips namespace prefixes
    // from element names. e.g. SendBillSyncResponse matches both
    // SendBillSyncResponse and wcf:SendBillSyncResponse.
    const responseKey = Object.keys(body).find(
      (k) => k.endsWith('Response') || k === resultKey,
    );

    if (!responseKey) {
      // Return the entire body so the caller can inspect error details.
      return body;
    }

    const responseContainer = body[responseKey] as Record<string, unknown> | undefined;
    if (!responseContainer) return null;

    // The result is typically nested under `${operation}Result`.
    const resultKeyInner = Object.keys(responseContainer).find(
      (k) => k.endsWith('Result'),
    );

    if (resultKeyInner) {
      return (responseContainer[resultKeyInner] as Record<string, unknown>) ?? null;
    }

    return responseContainer;
  }
}
