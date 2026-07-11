import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const CODE_FORMAT = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const CODE_COUNT = 10;
const CODE_LENGTH = 4; // per segment, two segments = 9 chars total (XXXX-XXXX)

@Injectable()
export class BackupCodesService {
  /**
   * Generate a set of backup codes for TOTP recovery.
   * Returns the plaintext codes (to show once) and their hashes (for storage).
   */
  generate(): { codes: string[]; hashes: string[] } {
    const codes: string[] = [];
    const hashes: string[] = [];

    for (let i = 0; i < CODE_COUNT; i++) {
      const code = this.generateCode();
      codes.push(code);
      hashes.push(this.hash(code));
    }

    return { codes, hashes };
  }

  /**
   * Verify a backup code against a list of hashes.
   * Returns the index of the consumed code on success, or -1 on failure.
   */
  verify(code: string, hashes: string[]): number {
    const formatted = code.toUpperCase().trim();

    if (!CODE_FORMAT.test(formatted)) {
      return -1;
    }

    const codeHash = this.hash(formatted);

    for (let i = 0; i < hashes.length; i++) {
      if (hashes[i] === codeHash) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Mark a code as consumed by removing its hash from the list.
   */
  consume(hashes: string[], index: number): string[] {
    const updated = [...hashes];
    updated.splice(index, 1);
    return updated;
  }

  /**
   * Get remaining code count for user warnings.
   */
  remainingCount(hashes: string[]): number {
    return hashes.length;
  }

  private generateCode(): string {
    const segment1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const segment2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${segment1}-${segment2}`;
  }

  private hash(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }
}
