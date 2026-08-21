import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';

/**
 * Plaintext contents of a DIAN certificate bundle before encryption.
 * All three values are credentials — none of them may ever reach a
 * database column or an API response in the clear.
 */
export interface FiscalCertificateBundle {
  p12Base64: string;
  password: string;
  softwareSecurityCode: string;
}

/** Env var holding the base64-encoded 32-byte key-encryption key (KEK). */
export const FISCAL_CERTIFICATE_KEK_ENV = 'FISCAL_CERTIFICATE_KEK_BASE64';

export const CURRENT_KEK_VERSION = 'v1';

const AES_256_GCM_IV_LENGTH = 12;
const AES_256_GCM_TAG_LENGTH = 16;
const KEK_BYTE_LENGTH = 32;

/**
 * Encrypts and decrypts fiscal certificate bundles at rest using
 * AES-256-GCM with a key-encryption key sourced from the environment.
 *
 * The KEK lives in `FISCAL_CERTIFICATE_KEK_BASE64` — in production it is
 * injected into process.env from Infisical at boot, in development from the
 * local .env. The bundle format is [iv(12) | authTag(16) | ciphertext].
 * `keyEncryptionKeyVersion` is stored next to the ciphertext so a future
 * KEK rotation can re-encrypt rows in place without schema changes.
 */
@Injectable()
export class FiscalCertificateCryptoService {
  encryptBundle(bundle: FiscalCertificateBundle): {
    encryptedBundle: Buffer;
    keyVersion: string;
  } {
    const kek = this.getKek();
    const iv = randomBytes(AES_256_GCM_IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(bundle), 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedBundle: Buffer.concat([iv, authTag, ciphertext]),
      keyVersion: CURRENT_KEK_VERSION,
    };
  }

  decryptBundle(encryptedBundle: Buffer): FiscalCertificateBundle {
    if (
      encryptedBundle.length <
      AES_256_GCM_IV_LENGTH + AES_256_GCM_TAG_LENGTH
    ) {
      throw new Error('Encrypted certificate bundle is truncated');
    }

    const kek = this.getKek();
    const iv = encryptedBundle.subarray(0, AES_256_GCM_IV_LENGTH);
    const authTag = encryptedBundle.subarray(
      AES_256_GCM_IV_LENGTH,
      AES_256_GCM_IV_LENGTH + AES_256_GCM_TAG_LENGTH,
    );
    const ciphertext = encryptedBundle.subarray(
      AES_256_GCM_IV_LENGTH + AES_256_GCM_TAG_LENGTH,
    );

    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString('utf-8')) as FiscalCertificateBundle;
  }

  /**
   * Derives the KEK from the environment. The value is stored as base64 so
   * it can be typed into env files without binary escaping issues; 32 bytes
   * decode to a full AES-256 key.
   */
  private getKek(): Buffer {
    const encoded = process.env[FISCAL_CERTIFICATE_KEK_ENV];
    if (!encoded) {
      throw new Error(
        `Missing ${FISCAL_CERTIFICATE_KEK_ENV} — set a base64-encoded 32-byte key (generate with: openssl rand -base64 32)`,
      );
    }
    const kek = Buffer.from(encoded, 'base64');
    if (kek.length !== KEK_BYTE_LENGTH) {
      throw new Error(
        `${FISCAL_CERTIFICATE_KEK_ENV} must decode to exactly 32 bytes, got ${kek.length}`,
      );
    }
    return kek;
  }

  /** Stable identifier for a bundle's contents (used for change detection). */
  hashBundle(bundle: FiscalCertificateBundle): string {
    return createHash('sha256')
      .update(bundle.p12Base64)
      .update(bundle.password)
      .update(bundle.softwareSecurityCode)
      .digest('hex');
  }
}
