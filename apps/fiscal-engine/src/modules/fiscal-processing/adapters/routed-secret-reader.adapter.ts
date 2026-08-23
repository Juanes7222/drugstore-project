import { Injectable } from '@nestjs/common';
import type { SecretReaderPort, SecretData } from '../ports/secret-reader.port';
import { DbCertificateSecretReaderAdapter } from './db-certificate-secret-reader.adapter';
import { FileSystemSecretReaderAdapter } from './file-system-secret-reader.adapter';

/**
 * Routes secret resolution by credential reference:
 *   - "file:"-prefixed references resolve to server-side credentials (our
 *     tech-provider certificate bundle, stored in the secret store) — the
 *     PROVIDER transmission path.
 *   - Anything else resolves to the tenant's own ACTIVE FiscalCertificate —
 *     the DIAN_DIRECT path.
 *
 * Registered as the single SECRET_READER_PORT so the transmission services
 * switch transmission parties per plan without changing their call sites.
 */
@Injectable()
export class RoutedSecretReaderAdapter implements SecretReaderPort {
  constructor(
    private readonly dbCertificateReader: DbCertificateSecretReaderAdapter,
    private readonly fileSystemReader: FileSystemSecretReaderAdapter,
  ) {}

  async readSecret(
    subscriptionId: string,
    reference: string,
  ): Promise<SecretData> {
    if (reference.startsWith('file:')) {
      return this.fileSystemReader.readSecret(subscriptionId, reference);
    }
    return this.dbCertificateReader.readSecret(subscriptionId, reference);
  }
}