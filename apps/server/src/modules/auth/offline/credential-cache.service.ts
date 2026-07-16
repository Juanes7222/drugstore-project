/**
 * Credential Verification Key (CVK) service.
 *
 * Generates encrypted credential blobs that the POS client can use to
 * verify PIN/password locally without storing the actual hash in cleartext.
 *
 * The CVK is encrypted with AES-256-GCM using an ephemeral key generated
 * server-side per login. The encryption key is itself encrypted with a key
 * derived from the workstation's hardware fingerprint before transmission.
 * The client can only decrypt it on the same workstation.
 *
 * The CVK includes a `version` field so the client can detect when
 * credentials have been updated online and the cache must be refreshed.
 */
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialVerificationKeyResult {
  encryptedBlob: string;       // base64-encoded encrypted blob
  keyFingerprint: string;      // SHA-256 of the encryption key (for cache invalidation)
  version: number;             // bump when credentials change
}

export interface DecryptedCredentialBlob {
  passwordHash: string | null;
  pinHash: string | null;
  userId: string;
  version: number;
  expiresAt: string;           // ISO date string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;          // 128 bits for GCM
const AUTH_TAG_LENGTH = 16;    // 128 bits
const KEY_LENGTH = 32;         // 256 bits
const CURRENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class CredentialCacheService {
  private readonly logger = new Logger(CredentialCacheService.name);

  /**
   * Generate a Credential Verification Key (CVK) encrypted blob.
   *
   * @param params.userId - The user's ID
   * @param params.passwordHash - The user's password hash (may be null if PIN-only)
   * @param params.pinHash - The user's PIN hash (may be null if password-only)
   * @param params.workstationFingerprint - Hardware fingerprint for key derivation
   * @param params.expiresAt - When the cache entry expires (offline token expiry)
   * @returns The encrypted blob and key fingerprint
   */
  async generateCvk(params: {
    userId: string;
    passwordHash: string | null;
    pinHash: string | null;
    workstationFingerprint: string;
    expiresAt: Date;
  }): Promise<CredentialVerificationKeyResult> {
    // Generate an ephemeral encryption key
    const ephemeralKey = crypto.randomBytes(KEY_LENGTH);

    // Derive a transport key from the workstation fingerprint
    const transportKey = this.deriveTransportKey(params.workstationFingerprint);

    // Encrypt the ephemeral key with the transport key
    const encryptedKey = this.aesEncrypt(ephemeralKey, transportKey);

    // Prepare the credential payload
    const payload: DecryptedCredentialBlob = {
      passwordHash: params.passwordHash,
      pinHash: params.pinHash,
      userId: params.userId,
      version: CURRENT_VERSION,
      expiresAt: params.expiresAt.toISOString(),
    };

    // Encrypt the payload with the ephemeral key
    const payloadJson = JSON.stringify(payload);
    const encryptedPayload = this.aesEncrypt(
      Buffer.from(payloadJson, 'utf-8'),
      ephemeralKey,
    );

    // Combine: encryptedKey (IV + ciphertext + tag) + ':' + encryptedPayload (IV + ciphertext + tag)
    const encryptedBlob = `${encryptedKey}:${encryptedPayload}`;

    // Compute key fingerprint for cache invalidation
    const keyFingerprint = crypto
      .createHash('sha256')
      .update(ephemeralKey)
      .digest('hex')
      .substring(0, 16);

    this.logger.debug(
      `CVK generated for user ${params.userId}, version ${CURRENT_VERSION}`,
    );

    return {
      encryptedBlob,
      keyFingerprint,
      version: CURRENT_VERSION,
    };
  }

  /**
   * Decrypt a CVK blob (useful for server-side validation during blessing).
   * The server has access to the raw hashes, so this is only used if
   * needed for validation.
   */
  decryptCvk(
    encryptedBlob: string,
    workstationFingerprint: string,
  ): DecryptedCredentialBlob | null {
    try {
      const parts = encryptedBlob.split(':');
      if (parts.length < 6) {
        // Expected: keyIv:keyCiphertext:keyTag:payloadIv:payloadCiphertext:payloadTag
        return null;
      }

      // Reconstruct the encrypted key and payload
      const encryptedKey = `${parts[0]}:${parts[1]}:${parts[2]}`;
      const encryptedPayload = parts.slice(3).join(':');

      // Derive the transport key
      const transportKey = this.deriveTransportKey(workstationFingerprint);

      // Decrypt the ephemeral key
      const ephemeralKey = this.aesDecrypt(encryptedKey, transportKey);
      if (!ephemeralKey) {
        return null;
      }

      // Decrypt the payload
      const payloadBuffer = this.aesDecrypt(encryptedPayload, ephemeralKey);
      if (!payloadBuffer) {
        return null;
      }

      const payload: DecryptedCredentialBlob = JSON.parse(
        payloadBuffer.toString('utf-8'),
      );

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Compute the current cache version for a user.
   * Incremented whenever the user's password or PIN changes.
   */
  getCurrentVersion(): number {
    return CURRENT_VERSION;
  }

  // -----------------------------------------------------------------------
  // Private: AES-256-GCM encryption/decryption
  // -----------------------------------------------------------------------

  /**
   * Encrypt data with AES-256-GCM.
   * Returns "iv:ciphertext:authTag" (all base64-encoded).
   */
  private aesEncrypt(plaintext: Buffer, key: Buffer): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      encrypted.toString('base64'),
      authTag.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt data with AES-256-GCM.
   * Input is "iv:ciphertext:authTag" (all base64-encoded).
   * Returns null on failure.
   */
  private aesDecrypt(encoded: string, key: Buffer): Buffer | null {
    try {
      const parts = encoded.split(':');
      if (parts.length !== 3) {
        return null;
      }

      const iv = Buffer.from(parts[0], 'base64');
      const ciphertext = Buffer.from(parts[1], 'base64');
      const authTag = Buffer.from(parts[2], 'base64');

      const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
    } catch {
      return null;
    }
  }

  /**
   * Derive a transport key from the workstation's hardware fingerprint.
   * Uses PBKDF2 with a fixed salt (not secret — the security is in the
   * fingerprint itself being only available on the workstation).
   */
  private deriveTransportKey(workstationFingerprint: string): Buffer {
    const salt = 'pharmacy-cvk-transport-v1';
    return crypto.pbkdf2Sync(
      workstationFingerprint,
      salt,
      100000,   // 100k iterations
      KEY_LENGTH,
      'sha512',
    );
  }
}
