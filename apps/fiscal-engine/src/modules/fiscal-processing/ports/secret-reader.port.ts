/**
 * Port for resolving a TechProviderConfig.credentialReference into the
 * actual PKCS#12 certificate bytes, its private-key password, and the
 * 48-character software security code issued by DIAN during software
 * registration.
 *
 * The reference format is adapter-specific:
 *   - FileSystemSecretReaderAdapter uses "file:relative/path.json"
 *   - A future Vault adapter would use "vault:secret/data/dian/cert"
 *
 * The software security code lives in the secret store rather than in a
 * database column because it is a DIAN-issued credential that belongs
 * alongside the certificate in whatever secure storage the deployment uses —
 * adding a column to FiscalIssuerConfig would couple the schema to this
 * specific credential, while the secret-reader abstraction keeps it
 * replaceable.
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
   * Resolves a credential reference to the certificate, password, and
   * software security code.
   * Throws if the reference cannot be resolved or the data is unreadable.
   */
  readSecret(reference: string): Promise<SecretData>;
}
