import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { EnvConfig } from '@/config/env.schema';

/**
 * TOTP service implementing RFC 6238.
 *
 * Setup flow:
 * 1. generateSecret() → returns a base32-encoded secret + otpauth:// URI
 * 2. verifySetup(secret, userCode) → confirms the user scanned the QR correctly
 * 3. Once confirmed, store the encrypted secret in the User record
 *
 * Verification:
 * - verify(encryptedSecret, userCode) → checks against current 30-sec window
 * - 1-step skew tolerance (window of -30s, 0, +30s)
 *
 * Backup codes are handled by BackupCodesService.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly issuer: string;
  private readonly encryptionKey: Buffer;

  constructor(private configService: ConfigService<EnvConfig>) {
    this.issuer = this.configService.get('TOTP_ISSUER') || 'PharmacyPOS';
    const key = this.configService.get('TOTP_ENCRYPTION_KEY');
    if (!key) {
      this.logger.warn(
        'TOTP_ENCRYPTION_KEY is not set — using a derived key. ' +
          'In production, set a 32-byte hex-encoded key explicitly.',
      );
      // Derive a deterministic key from JWT_ACCESS_SECRET as fallback
      this.encryptionKey = crypto
        .createHash('sha256')
        .update(this.configService.get('JWT_ACCESS_SECRET') || 'fallback-key')
        .digest();
    } else {
      this.encryptionKey = Buffer.from(key, 'hex');
    }
  }

  /**
   * Generate a new TOTP secret and return the setup URI and raw secret.
   * The secret is returned unencrypted so the caller can display it as
   * a QR code; the caller is responsible for encrypting it before storage.
   */
  generateSecret(accountName: string): {
    secret: string; // base32
    otpauthUri: string;
    qrCodeUrl: string;
  } {
    // RFC 4226 recommends at least 160 bits (32 chars in base32)
    const rawSecret = crypto.randomBytes(20);
    const secret = this.base32Encode(rawSecret);

    const otpauthUri = this.buildOtpauthUri(secret, accountName);
    const qrCodeUrl = this.buildQrCodeUrl(otpauthUri);

    return { secret, otpauthUri, qrCodeUrl };
  }

  /**
   * Verify a TOTP code against a secret (during setup confirmation).
   * The secret is the raw base32-encoded string, not yet encrypted.
   */
  verifySetup(secret: string, userCode: string): boolean {
    return this.verifyCode(secret, userCode);
  }

  /**
   * Verify a TOTP code against an encrypted secret (during login).
   */
  verify(encryptedSecret: string, userCode: string): boolean {
    const decrypted = this.decrypt(encryptedSecret);
    // For storage, we store the raw base32 secret (not a hash — we need the
    // actual secret to compute TOTP codes). The "encryption" is AES-256-GCM
    // on the secret string stored as JSON.
    let secret: string;
    try {
      const parsed = JSON.parse(decrypted);
      secret = parsed.secret;
    } catch {
      secret = decrypted; // fallback for legacy format
    }
    return this.verifyCode(secret, userCode);
  }

  /**
   * Encrypt a TOTP secret for storage.
   */
  encryptSecret(secret: string): string {
    const payload = JSON.stringify({ secret, algorithm: 'TOTP-SHA1' });
    return this.encrypt(payload);
  }

  /**
   * Decrypt a stored TOTP secret.
   */
  decryptSecret(encrypted: string): string {
    const decrypted = this.decrypt(encrypted);
    try {
      const parsed = JSON.parse(decrypted);
      return parsed.secret;
    } catch {
      return decrypted;
    }
  }

  private verifyCode(secret: string, userCode: string): boolean {
    if (!/^\d{6}$/.test(userCode)) {
      return false;
    }

    const counter = Math.floor(Date.now() / 30000);

    // Check current window and ±1 window (skew tolerance)
    for (let i = -1; i <= 1; i++) {
      const expected = this.generateTOTP(secret, counter + i);
      if (expected === userCode) {
        return true;
      }
    }

    return false;
  }

  private generateTOTP(secret: string, counter: number): string {
    const decoded = this.base32Decode(secret);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUint64BE(BigInt(counter));

    const hmac = crypto.createHmac('sha1', decoded);
    hmac.update(counterBuffer);
    const digest = hmac.digest();

    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  }

  private buildOtpauthUri(secret: string, accountName: string): string {
    const params = new URLSearchParams({
      secret,
      issuer: this.issuer,
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
    return `otpauth://totp/${encodeURIComponent(this.issuer)}:${encodeURIComponent(accountName)}?${params.toString()}`;
  }

  private buildQrCodeUrl(otpauthUri: string): string {
    // Returns a URL for a QR code API; can be rendered as an <img> tag
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`;
  }

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({ iv: iv.toString('hex'), encrypted, authTag });
  }

  private decrypt(encryptedPayload: string): string {
    const { iv, encrypted, authTag } = JSON.parse(encryptedPayload);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private base32Encode(buffer: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i];
      bits += 8;
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += alphabet[(value << (5 - bits)) & 31];
    }

    return output;
  }

  private base32Decode(encoded: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = encoded.replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (let i = 0; i < cleaned.length; i++) {
      value = (value << 5) | alphabet.indexOf(cleaned[i]);
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(bytes);
  }
}
