/**
 * Helpers for the activation page.
 *
 * @category Utilities
 */

const MAX_CODE_LENGTH = 12;

/**
 * Format raw input into activation-code groups of 4 separated by dashes.
 * Only keeps alphanumeric characters, uppercases them, and limits to 12 chars.
 */
export function formatActivationCode(raw: string): string {
  const cleaned = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length && i < MAX_CODE_LENGTH; i += 4) {
    groups.push(cleaned.slice(i, i + 4));
  }
  return groups.join("-");
}

/**
 * Strip dashes to get the raw code for submission.
 */
export function stripCodeFormatting(formatted: string): string {
  return formatted.replace(/-/g, "");
}
