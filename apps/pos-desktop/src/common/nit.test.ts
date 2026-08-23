/**
 * Unit tests for the DIAN NIT helpers (sanitization, verification digit,
 * NIT-DV validation and splitting).
 *
 * Fixtures with a valid DV are computed in-file with an independent inline
 * implementation of the modulo-11 algorithm so the tests never validate the
 * production implementation against itself.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateNitVerificationDigit,
  isValidNitDv,
  sanitizeNitInput,
  splitNitWithDv,
} from './nit';

// ---------------------------------------------------------------------------
// Fixture helpers — independent modulo-11 implementation (weights applied
// from the least significant digit, cycling after the last weight).
// ---------------------------------------------------------------------------

const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

function computeVerificationDigit(nitDigits: string): string {
  let sum = 0;
  for (let i = 0; i < nitDigits.length; i += 1) {
    const digit = Number(nitDigits[nitDigits.length - 1 - i]);
    sum += digit * WEIGHTS[i % WEIGHTS.length];
  }

  const remainder = sum % 11;
  if (remainder === 0) return '0';
  const digit = 11 - remainder;
  return digit === 10 ? '9' : String(digit);
}

/** Pick a DV that differs from the real one so "wrong DV" fixtures stay stable. */
function wrongVerificationDigit(nitDigits: string): string {
  const real = computeVerificationDigit(nitDigits);
  return real === '9' ? '0' : '9';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sanitizeNitInput', () => {
  it('strips dots, dashes and spaces from a formatted NIT-DV string', () => {
    expect(sanitizeNitInput('900.123.456-7')).toBe('9001234567');
  });

  it('keeps only digits from mixed input', () => {
    expect(sanitizeNitInput('NIT 900.123.456 - 7')).toBe('9001234567');
  });

  it('returns an empty string for input without digits', () => {
    expect(sanitizeNitInput('')).toBe('');
    expect(sanitizeNitInput('ABC-*')).toBe('');
  });
});

describe('calculateNitVerificationDigit', () => {
  it('matches the independently computed DV for a known 9-digit NIT', () => {
    expect(calculateNitVerificationDigit('900123456')).toBe('8');
  });

  it.each([8, 9, 10, 11, 12, 13, 14, 15])(
    'agrees with the independent implementation for %i-digit NITs',
    (length) => {
      const nit = '1234567890'.slice(0, length).padEnd(length, '4');
      expect(calculateNitVerificationDigit(nit)).toBe(
        computeVerificationDigit(nit),
      );
    },
  );

  it('sanitizes formatting before computing', () => {
    const nit = '900.123.456';
    expect(calculateNitVerificationDigit(nit)).toBe(
      computeVerificationDigit('900123456'),
    );
  });

  it('throws RangeError for a NIT below 8 digits', () => {
    expect(() => calculateNitVerificationDigit('1234567')).toThrow(RangeError);
  });

  it('throws RangeError for a NIT above 15 digits', () => {
    expect(() => calculateNitVerificationDigit('1234567890123456')).toThrow(
      RangeError,
    );
  });

  it('throws RangeError with the accepted length range in the message', () => {
    expect(() => calculateNitVerificationDigit('1234567')).toThrow(
      /between 8 and 15 digits/,
    );
  });
});

describe('isValidNitDv', () => {
  it('accepts a NIT whose DV matches the DIAN algorithm', () => {
    const nit = '900123456';
    expect(isValidNitDv(nit, computeVerificationDigit(nit))).toBe(true);
  });

  it('accepts 10-digit and 15-digit NITs with a matching DV', () => {
    expect(isValidNitDv('9012345678', computeVerificationDigit('9012345678'))).toBe(
      true,
    );
    expect(
      isValidNitDv('123456789012345', computeVerificationDigit('123456789012345')),
    ).toBe(true);
  });

  it('rejects a NIT whose DV does not match', () => {
    const nit = '900123456';
    expect(isValidNitDv(nit, wrongVerificationDigit(nit))).toBe(false);
  });

  it('rejects a NIT with fewer than 8 digits', () => {
    expect(isValidNitDv('1234567', '0')).toBe(false);
  });

  it('rejects a NIT with more than 15 digits', () => {
    expect(isValidNitDv('1234567890123456', '0')).toBe(false);
  });

  it('rejects a non-digit DV', () => {
    expect(isValidNitDv('900123456', 'X')).toBe(false);
  });

  it('rejects an empty DV', () => {
    expect(isValidNitDv('900123456', '')).toBe(false);
  });

  it('rejects a multi-digit DV', () => {
    expect(isValidNitDv('900123456', '12')).toBe(false);
  });

  it('sanitizes formatting in both NIT and DV before validating', () => {
    const nit = '900.123.456';
    expect(isValidNitDv(nit, computeVerificationDigit('900123456'))).toBe(true);
  });
});

describe('splitNitWithDv', () => {
  it('splits a dotted NIT-DV string', () => {
    expect(splitNitWithDv('900.123.456-7')).toEqual({
      nit: '900123456',
      dv: '7',
    });
  });

  it('splits a bare-digit NIT-DV string', () => {
    expect(splitNitWithDv('900123456-8')).toEqual({
      nit: '900123456',
      dv: '8',
    });
  });

  it('splits a NIT-DV string with a space before the dash', () => {
    expect(splitNitWithDv('900.123.456 -7')).toEqual({
      nit: '900123456',
      dv: '7',
    });
  });

  it('splits a NIT-DV embedded in a longer line', () => {
    expect(splitNitWithDv('NIT 900.123.456-7')).toEqual({
      nit: '900123456',
      dv: '7',
    });
  });

  it('returns null when the input has no NIT-DV pattern', () => {
    expect(splitNitWithDv('900123456')).toBeNull();
    expect(splitNitWithDv('no digits here')).toBeNull();
  });

  it('returns null when the NIT part is shorter than 8 digits', () => {
    expect(splitNitWithDv('123-4')).toBeNull();
  });

  it('returns null when the NIT part is longer than 15 digits', () => {
    expect(splitNitWithDv('1234567890123456-0')).toBeNull();
  });
});