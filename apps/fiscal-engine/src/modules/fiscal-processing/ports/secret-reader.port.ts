/**
 * Port for resolving the credential material the DIAN_DIRECT path needs:
 * the PKCS#12 certificate bytes, its private-key password, and the
 * 48-character software security code issued by DIAN during software
 * registration.
 *
 * The subscription id is part of the contract so a multi-tenant deployment
 * can never resolve one tenant's certificate for another tenant's document
 * (the historical findFirst-based lookup did exactly that).
 *
 * Reference format is adapter-specific:
 *   - FileSystemSecretReaderAdapter uses "file:relative/path.json" and
 *     ignores the subscription id (development-only).
 *   - DbCertificateSecretReaderAdapter ignores the reference and reads the
 *     tenant's ACTIVE FiscalCertificate row, decrypting its bundle.
 */
export const SECRET_READER_PORT = Symbol('SecretReaderPort');

export interface SecretData {
  /** Raw bytes of the PKCS#12 (.p12 / .pfx) certificate file. */
  certificate: Buffer;

  /** Private-key password for the certificate. */
  password: string;

  /**
   * 48-character fingerprint (huella) issued by DIAN when the invoicing
   * software is registered in the DIAN system. Used in
   * sts:SoftwareSecurityCode within DianExtensions.
   */
  softwareSecurityCode: string;
}

export interface SecretReaderPort {
  /**
   * Resolves the subscription's certificate credential material.
   * Throws if the reference cannot be resolved or the data is unreadable.
   */
  readSecret(subscriptionId: string, reference: string): Promise<SecretData>;
}