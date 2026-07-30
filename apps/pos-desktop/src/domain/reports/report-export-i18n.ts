import type { ExportInput } from './report-export.types';

export function tr(
  translator: ExportInput['t'],
  key: string,
  fallback: string,
): string {
  return translator ? translator(key, { defaultValue: fallback }) : fallback;
}