import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

// scrypt parameters: N=16384, r=8, p=1 — OWASP recommended minimum for
// interactive logins. Combined with application-level rate limiting this
// is sufficient for short PIN values (4–6 digits).
const SCRYPT_PARAMS: crypto.ScryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024,
};
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hash a PIN using Node.js built-in scrypt with a random salt.
 * scrypt is ASIC/FPGA resistant and built into Node.js with no extra
 * dependencies. The output is a colon-separated string of base64-encoded
 * salt and derived key, stored in the user's `pinHash` column.
 */
@Injectable()
export class PinService {
  async hash(pin: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const derivedKey = await this.scryptAsync(pin, salt.toString('base64'));
    return `${salt.toString('base64')}:${derivedKey}`;
  }

  /**
   * Verify a PIN against its stored hash.
   * Compares derived keys in constant time (Node's Buffer.timingSafeEqual).
   */
  async verify(pinHash: string, pin: string): Promise<boolean> {
    const colonIdx = pinHash.indexOf(':');
    if (colonIdx === -1) {
      return false;
    }
    const salt = pinHash.slice(0, colonIdx);
    const expected = pinHash.slice(colonIdx + 1);
    try {
      const derivedKey = await this.scryptAsync(pin, salt);
      if (derivedKey.length !== expected.length) {
        return false;
      }
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'base64'),
        Buffer.from(derivedKey, 'base64'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Generate a random numeric PIN of the given length (default 6).
   */
  generate(length = 6): string {
    const min = 10 ** (length - 1);
    const max = 10 ** length - 1;
    const pin = Math.floor(min + Math.random() * (max - min + 1));
    return pin.toString();
  }

  /**
   * Validate that a PIN meets the format requirements.
   */
  validate(pin: string, minLength = 4, maxLength = 6): boolean {
    return /^\d+$/.test(pin) && pin.length >= minLength && pin.length <= maxLength;
  }

  private scryptAsync(input: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      crypto.scrypt(input, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, key) => {
        if (err) {
          reject(err);
        } else {
          resolve(key.toString('base64'));
        }
      });
    });
  }
}
