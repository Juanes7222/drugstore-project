import { createDecipheriv } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Decrypts the FiscalCertificate.encryptedBundle envelope written by
 * apps/server (FiscalCertificateCryptoService). Format:
 * [iv(12) | authTag(16) | ciphertext] under AES-256-GCM, KEK from
 * FISCAL_CERTIFICATE_KEK_BASE64 (base64, 32 bytes).
 *
 * This is the engine-side half of the certificate-at-rest scheme; the
 * encryption side lives in apps/server. The two apps do not import each
 * other's code, so the envelope constants are duplicated here by design.
 */
export interface DecryptedCertificateBundle {
  p12Base64: string;
  password: string;
  softwareSecurityCode: string;
}

const KEK_ENV_VAR = 'FISCAL_CERTIFICATE_KEK_BASE64';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class FiscalCertificateBundleDecrypter {
  decrypt(encryptedBundle: Uint8Array): DecryptedCertificateBundle {
    if (encryptedBundle.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Encrypted certificate bundle is truncated');
    }
    const bytes = Buffer.from(encryptedBundle);

    const encoded = process.env[KEK_ENV_VAR];
    if (!encoded) {
      throw new Error(
        `Missing ${KEK_ENV_VAR} — the fiscal engine cannot decrypt certificates without it`,
      );
    }
    const kek = Buffer.from(encoded, 'base64');
    if (kek.length !== 32) {
      throw new Error(`${KEK_ENV_VAR} must decode to exactly 32 bytes`);
    }

    const iv = bytes.subarray(0, IV_LENGTH);
    const authTag = bytes.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = bytes.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString('utf-8')) as DecryptedCertificateBundle;
  }
}

/**
 * Resolves the tenant's ACTIVE certificate from the database and decrypts
 * its bundle. The credentialReference argument is ignored — the schema now
 * owns the certificate, so the reference exists only for the development
 * file adapter's sake.
 */
@Injectable()
export class DbCertificateSecretReaderAdapter {
  private readonly logger = new Logger(DbCertificateSecretReaderAdapter.name);
  private readonly decrypter = new FiscalCertificateBundleDecrypter();

  constructor(private readonly prisma: PrismaService) {}

  async readSecret(subscriptionId: string, _reference: string) {
    const certificate = await this.prisma.fiscalCertificate.findFirst({
      where: { subscriptionId, status: 'ACTIVE' },
      orderBy: { validTo: 'desc' },
      select: {
        encryptedBundle: true,
        alias: true,
        validTo: true,
      },
    });

    if (!certificate) {
      throw new Error(
        `No ACTIVE fiscal certificate for subscription ${subscriptionId} — ` +
          'upload one via POST /fiscal-dian/certificates',
      );
    }

    this.logger.log(
      `Using certificate "${certificate.alias}" (valid until ${certificate.validTo.toISOString()}) ` +
        `for subscription ${subscriptionId}`,
    );

    const bundle = this.decrypter.decrypt(certificate.encryptedBundle);

    return {
      certificate: Buffer.from(bundle.p12Base64, 'base64'),
      password: bundle.password,
      softwareSecurityCode: bundle.softwareSecurityCode,
    };
  }
}