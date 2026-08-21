/**
 * Translation helper for export documents.
 *
 * Accepts an optional i18next `t` function; when absent (or when the key is
 * missing) the caller-provided fallback string is used so exports never
 * render an empty header or a raw key.
 */

import type { ExportTranslator } from './export-types';

export function tr(
  translator: ExportTranslator | undefined,
  key: string,
  fallback: string,
): string {
  return translator ? translator(key, { defaultValue: fallback }) : fallback;
}