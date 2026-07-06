import { SendResult, StatusResult } from './transmission-results.type';

/**
 * Port that abstracts DIAN document transmission behind a local interface.
 *
 * Exists so that dian-sdk-node (or any future SDK) is an implementation
 * detail behind this contract. If the SDK ever proves inadequate against
 * DIAN's actual habilitación test set, a new adapter behind the same port
 * replaces it without restructuring this module.
 */
export const FISCAL_TRANSMISSION_PORT = Symbol('FiscalTransmissionPort');

export interface FiscalTransmissionPort {
  /**
   * Signs the unsigned UBL XML with the given certificate and transmits it
   * to DIAN's web service. The XAdES-EPES signing is performed inside the
   * SDK as part of the same call.
   *
   * @param unsignedXml   The UBL 2.1 invoice XML without a digital signature.
   * @param fileName      The file name passed to DIAN (e.g. "FV-DEMO-001.xml").
   * @param certificate   The PKCS#12 certificate as a byte buffer.
   * @param certPassword  The certificate's private-key password.
   * @param environment   DIAN environment identifier: "1" for production, "2" for habilitación.
   */
  signAndSend(
    unsignedXml: string,
    fileName: string,
    certificate: Buffer,
    certPassword: string,
    environment: string,
  ): Promise<SendResult>;

  /**
   * Queries DIAN for the current processing status of a previously
   * transmitted document.
   *
   * @param trackId       The tracking identifier returned by DIAN (XmlDocumentKey).
   * @param certificate   The PKCS#12 certificate used for authentication.
   * @param certPassword  The certificate's private-key password.
   * @param environment   DIAN environment identifier.
   */
  checkStatus(
    trackId: string,
    certificate: Buffer,
    certPassword: string,
    environment: string,
  ): Promise<StatusResult>;
}
