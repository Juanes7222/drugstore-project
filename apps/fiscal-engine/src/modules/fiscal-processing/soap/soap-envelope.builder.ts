import { NS_SOAP_ENVELOPE, NS_DIAN_COLOMBIA } from '../signing/dian-constants';

/**
 * Builds the unsigned SOAP 1.2 envelope body for DIAN operations.
 *
 * Each method produces a <soap:Envelope> with an empty <soap:Header/>
 * and the operation-specific <soap:Body>. The SoapSigner then adds
 * WS-Security headers and signs the wsa:To element.
 *
 * The returned string is a well-formed XML document that the caller
 * can parse into a DOM tree or pass directly to SoapSigner.
 */
export class SoapEnvelopeBuilder {
  /**
   * Builds a SOAP envelope for SendBillSync.
   *
   * @param fileName     The invoice file name (e.g. "FV-DEMO-001.xml").
   * @param contentFile  The XAdES-EPES signed UBL invoice, base64-encoded.
   */
  buildSendBillSync(fileName: string, contentFile: string): string {
    return this.wrapBody(`
      <wcf:SendBillSync xmlns:wcf="${NS_DIAN_COLOMBIA}">
        <wcf:fileName>${this.escapeXml(fileName)}</wcf:fileName>
        <wcf:contentFile>${contentFile}</wcf:contentFile>
      </wcf:SendBillSync>
    `);
  }

  /**
   * Builds a SOAP envelope for GetNumberingRange using the taxpayer
   * identity, per Technical Annex §7.15:
   *   - accountCode:  NIT of the invoicing party, no verification digit.
   *   - accountCodeT: NIT of the software owner — the same NIT for
   *     own-software pharmacies (the annex example sends both equal).
   *   - softwareCode: optional 16-char software identifier.
   *
   * This is the standalone "list my current ranges" query; it does not
   * require any prior document transmission.
   */
  buildGetNumberingRangeByTaxId(
    accountCode: string,
    accountCodeT: string,
    softwareCode = '',
  ): string {
    return this.wrapBody(`
      <wcf:GetNumberingRange xmlns:wcf="${NS_DIAN_COLOMBIA}">
        <wcf:accountCode>${this.escapeXml(accountCode)}</wcf:accountCode>
        <wcf:accountCodeT>${this.escapeXml(accountCodeT)}</wcf:accountCodeT>
        <wcf:softwareCode>${this.escapeXml(softwareCode)}</wcf:softwareCode>
      </wcf:GetNumberingRange>
    `);
  }

  /**
   * Builds a SOAP envelope for GetStatus.
   *
   * @param trackId  The XmlDocumentKey (CUFE) returned by DIAN after
   *                 a previous SendBillSync call.
   */
  buildGetStatus(trackId: string): string {
    return this.wrapBody(`
      <wcf:GetStatus xmlns:wcf="${NS_DIAN_COLOMBIA}">
        <wcf:trackId>${this.escapeXml(trackId)}</wcf:trackId>
      </wcf:GetStatus>
    `);
  }

  // ── Private ────────────────────────────────────────────────────────

  private wrapBody(bodyContent: string): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soap:Envelope xmlns:soap="${NS_SOAP_ENVELOPE}">` +
      `<soap:Header/>` +
      `<soap:Body>` +
      bodyContent +
      `</soap:Body>` +
      `</soap:Envelope>`
    );
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
