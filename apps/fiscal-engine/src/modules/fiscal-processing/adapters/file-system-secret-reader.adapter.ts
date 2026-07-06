import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SecretReaderPort, SecretData } from '../ports/secret-reader.port';

/**
 * Resolves "file:relative/path.p12" credential references by reading the
 * .p12 file from a configurable base directory and using a separate
 * environment variable for the private-key password.
 *
 * This adapter exists so the full pipeline can be run end to end in
 * development and in the DIAN habilitación environment, but a production
 * deployment should replace it with a Vault or cloud-secret-manager
 * adapter — the reference format and this adapter's name are intentionally
 * specific so the swap is obvious at the injection point.
 *
 * Environment variables consumed:
 *   CERTIFICATE_BASE_DIR    — root directory for file: references
 *   DIAN_CERTIFICATE_PASSWORD — password for every .p12 resolved this way
 */
@Injectable()
export class FileSystemSecretReaderAdapter implements SecretReaderPort {
  private readonly logger = new Logger(FileSystemSecretReaderAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  async readSecret(reference: string): Promise<SecretData> {
    if (!reference.startsWith('file:')) {
      throw new Error(
        `FileSystemSecretReaderAdapter only supports "file:"-prefixed references, got "${reference}"`,
      );
    }

    const relativePath = reference.slice('file:'.length);
    const baseDir = this.configService.getOrThrow<string>('CERTIFICATE_BASE_DIR');
    const absolutePath = resolve(baseDir, relativePath);

    this.logger.debug(`Reading certificate from ${absolutePath}`);

    const certificate = await readFile(absolutePath);

    const password = this.configService.getOrThrow<string>('DIAN_CERTIFICATE_PASSWORD');

    return { certificate, password };
  }
}
