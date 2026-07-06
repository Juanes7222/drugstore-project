/**
 * Port for resolving a TechProviderConfig.credentialReference into the
 * actual PKCS#12 certificate bytes and its private-key password.
 *
 * The reference format is adapter-specific:
 *   - FileSystemSecretReaderAdapter uses "file:relative/path.p12"
 *   - A future Vault adapter would use "vault:secret/data/dian/cert"
 */
export const SECRET_READER_PORT = Symbol('SecretReaderPort');

export interface SecretData {
  /** Raw bytes of the PKCS#12 (.p12 / .pfx) certificate file. */
  certificate: Buffer;

  /** Private-key password for the certificate. */
  password: string;
}

export interface SecretReaderPort {
  /**
   * Resolves a credential reference to the certificate and password.
   * Throws if the reference cannot be resolved or the certificate data
   * is unreadable.
   */
  readSecret(reference: string): Promise<SecretData>;
}
