import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SecretReaderPort, SecretData } from '../ports/secret-reader.port';

/**
 * Resolves "file:relative/path.json" credential references by reading a JSON
 * file from a configurable base directory. The JSON file must contain:
 *
 * ```json
 * {
 *   "certificate": "<base64-encoded PKCS#12 content>",
 *   "password": "<private-key password>",
 *   "softwareSecurityCode": "<48-character DIAN fingerprint>"
 * }
 * ```
 *
 * The software security code is stored here (alongside the certificate)
 * rather than in a database column because it is a DIAN-issued credential
 * that belongs in the secure store with the certificate. Adding a column to
 * FiscalIssuerConfig would couple the schema to this specific credential,
 * while the secret-reader abstraction keeps it replaceable.
 *
 * This adapter exists so the full pipeline can be run end to end in
 * development and in the DIAN habilitación environment, but a production
 * deployment should replace it with a Vault or cloud-secret-manager
 * adapter — the reference format and this adapter's name are intentionally
 * specific so the swap is obvious at the injection point.
 *
 * Environment variables consumed:
 *   CERTIFICATE_BASE_DIR    — root directory for file: references
 *   DIAN_CERTIFICATE_PASSWORD — no longer consumed directly; the password
 *                               lives inside the JSON secret file
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

    this.logger.debug(`Reading secret from ${absolutePath}`);

    const rawText = await readFile(absolutePath, 'utf-8');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(
        `File ${absolutePath} is not valid JSON — expected format: { "certificate": "<base64-p12>", "password": "...", "softwareSecurityCode": "..." }`,
      );
    }

    const certificateBase64 = parsed.certificate;
    if (typeof certificateBase64 !== 'string' || certificateBase64.length === 0) {
      throw new Error(
        `File ${absolutePath} is missing or has an invalid "certificate" field (expected base64-encoded PKCS#12 content as a non-empty string)`,
      );
    }

    const password = parsed.password;
    if (typeof password !== 'string') {
      throw new Error(
        `File ${absolutePath} is missing or has an invalid "password" field`,
      );
    }

    const softwareSecurityCode = parsed.softwareSecurityCode;
    if (typeof softwareSecurityCode !== 'string' || softwareSecurityCode.length === 0) {
      throw new Error(
        `File ${absolutePath} is missing or has an invalid "softwareSecurityCode" field (expected 48-character DIAN fingerprint)`,
      );
    }

    const certificate = Buffer.from(certificateBase64, 'base64');

    return { certificate, password, softwareSecurityCode };
  }
}
