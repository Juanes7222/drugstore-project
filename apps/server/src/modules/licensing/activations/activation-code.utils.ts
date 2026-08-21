// Pure helpers for generating human-friendly activation codes with a mod-10 checksum.

/** Default validity window for self-service subscription activation codes. */
export const DEFAULT_SUBSCRIPTION_CODE_TTL_DAYS = 30;

/**
 * Alphabet without confusable characters (no I, O, 0, 1).
 * Each code is 4 groups of 4 chars, dash-separated, plus a checksum digit.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateActivationCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  const code = groups.join('-');
  const checksum = computeActivationCodeChecksum(code.replace(/-/g, ''));
  return `${code}${checksum}`;
}

/** Luhn-like mod-10 checksum over the alphabet positions. */
export function computeActivationCodeChecksum(value: string): string {
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    const pos = CODE_ALPHABET.indexOf(value[i]);
    if (pos >= 0) {
      sum += pos * (i % 2 === 0 ? 1 : 3);
    }
  }
  const check = (10 - (sum % 10)) % 10;
  return check.toString();
}