import type { DianNumberingRange } from '@pharmacy/shared-types';
import { DianNumberingRangeOperationException } from '../exceptions/dian-numbering-range-operation.exception';

/**
 * Parses DIAN's GetNumberingRangeResult payload (Technical Annex §7.15.3):
 * OperationCode/OperationDescription plus a ResponseList of range entries.
 *
 * Pure and framework-free so the response contract is testable without any
 * SOAP/HTTP machinery. Field casing varies between annex revisions
 * (FromNumber/Prefijo vs fromNumber/prefix), so each field is read across
 * its known spellings. Entries missing a required field or with unparseable
 * bounds are skipped rather than failing the whole query — one malformed row
 * should not hide the valid ranges behind it.
 */
export function parseNumberingRangeResult(
  result: Record<string, unknown> | null,
): DianNumberingRange[] {
  if (!result) {
    throw new DianNumberingRangeOperationException('0', 'Empty DIAN response');
  }

  const operationCode =
    readString(result, ['OperationCode', 'operationCode']) ?? '0';
  const operationDescription =
    readString(result, ['OperationDescription', 'operationDescription']) ?? '';

  // 100 = Acción completada OK; anything else is a documented failure
  // (301 no ranges / 302,303 software mismatch / 401 unauthorized / 500 error).
  if (operationCode !== '100') {
    throw new DianNumberingRangeOperationException(operationCode, operationDescription);
  }

  let rawList = result.ResponseList ?? result.responseList;

  // fast-xml-parser keeps the WCF data-contract element as a wrapper:
  // a single range arrives as { NumberRangeResponse: {...} }, several
  // ranges as { NumberRangeResponse: [ {...}, ... ] }. Unwrap first.
  if (rawList && !Array.isArray(rawList) && typeof rawList === 'object') {
    const wrapper = rawList as Record<string, unknown>;
    const inner =
      wrapper.NumberRangeResponse ?? wrapper.numberRangeResponse ?? undefined;
    if (inner !== undefined) {
      rawList = inner;
    }
  }

  const entries = Array.isArray(rawList)
    ? rawList
    : rawList != null && typeof rawList === 'object'
      ? [rawList]
      : [];

  const ranges: DianNumberingRange[] = [];
  for (const entry of entries as Record<string, unknown>[]) {
    const parsed = parseRangeEntry(entry);
    if (parsed) {
      ranges.push(parsed);
    }
  }
  return ranges;
}

function parseRangeEntry(
  entry: Record<string, unknown>,
): DianNumberingRange | null {
  const resolutionNumber = readString(entry, ['ResolutionNumber', 'resolutionNumber']);
  const prefix = readString(entry, ['Prefix', 'prefix', 'Prefijo']);
  const fromNumber = readInt(entry, ['FromNumber', 'fromNumber']);
  const toNumber = readInt(entry, ['ToNumber', 'toNumber']);
  const validFrom = readString(entry, [
    'ValidDateFrom',
    'ValidDateTimeFrom',
    'validDateFrom',
    'validDateTimeFrom',
  ]);
  const validTo = readString(entry, [
    'ValidDateTo',
    'ValidDateTimeTo',
    'validDateTo',
    'validDateTimeTo',
  ]);
  const technicalKey = readString(entry, ['TechnicalKey', 'technicalKey', 'ClTec']) ?? '';

  if (
    !resolutionNumber ||
    !prefix ||
    fromNumber === null ||
    toNumber === null ||
    !validFrom ||
    !validTo
  ) {
    return null;
  }

  return { resolutionNumber, prefix, fromNumber, toNumber, validFrom, validTo, technicalKey };
}

function readString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return null;
}

function readInt(source: Record<string, unknown>, keys: string[]): number | null {
  const raw = readString(source, keys);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
