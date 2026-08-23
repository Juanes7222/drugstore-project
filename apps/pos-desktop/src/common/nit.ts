/**
 * Colombian NIT helpers — sanitization and verification-digit (DV)
 * validation using the public DIAN modulo-11 algorithm.
 *
 * Framework-free: usable from domain services, the RUT parser, and the
 * renderer without importing anything else.
 */

/** Valid NIT length range (excluding the verification digit). */
const NIT_MIN_DIGITS = 8;
const NIT_MAX_DIGITS = 15;

/**
 * Weight sequence for the DIAN verification-digit algorithm. Applied from
 * the least significant NIT digit upward, restarting after the last weight.
 */
const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/**
 * Strip every non-digit character from a raw NIT/DV input.
 *
 * Handles the common "900.123.456-7" formatting as well as bare digits.
 */
export function sanitizeNitInput(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Compute the DIAN verification digit for a NIT (without DV).
 *
 * Returns the DV as a single-digit string. Throws when the NIT is outside
 * the valid length range — callers should sanitize first.
 */
export function calculateNitVerificationDigit(nitInput: string): string {
  const nit = sanitizeNitInput(nitInput);
  if (nit.length < NIT_MIN_DIGITS || nit.length > NIT_MAX_DIGITS) {
    throw new RangeError(
      `NIT must have between ${NIT_MIN_DIGITS} and ${NIT_MAX_DIGITS} digits; got ${nit.length}`,
    );
  }

  let sum = 0;
  const digits = nit.split('').reverse();
  for (let i = 0; i < digits.length; i += 1) {
    sum += Number(digits[i]) * DV_WEIGHTS[i % DV_WEIGHTS.length];
  }

  const remainder = sum % 11;
  if (remainder === 0) return '0';

  const digit = 11 - remainder;
  // MUISCA renders a computed 10 as "9" (the NIT itself gets adjusted);
  // accept that convention so validation matches issued documents.
  return digit === 10 ? '9' : String(digit);
}

/**
 * Validate a NIT against its verification digit.
 *
 * Returns false for malformed input (wrong length, non-digit DV) instead
 * of throwing, so callers can treat it as a boolean check.
 */
export function isValidNitDv(nitInput: string, dvInput: string): boolean {
  const nit = sanitizeNitInput(nitInput);
  const dv = sanitizeNitInput(dvInput);
  if (nit.length < NIT_MIN_DIGITS || nit.length > NIT_MAX_DIGITS) return false;
  if (dv.length !== 1) return false;
  return calculateNitVerificationDigit(nit) === dv;
}

/**
 * Split a combined "NIT-DV" string (e.g. "900.123.456-7") into its parts.
 *
 * Returns null when no NIT-DV pattern is present.
 */
export function splitNitWithDv(input: string): {
  nit: string;
  dv: string;
} | null {
  const match = input.match(/(\d[\d.\s]*)-(\d)/);
  if (!match) return null;
  const nit = sanitizeNitInput(match[1]);
  const dv = match[2];
  if (nit.length < NIT_MIN_DIGITS || nit.length > NIT_MAX_DIGITS) return null;
  return { nit, dv };
}