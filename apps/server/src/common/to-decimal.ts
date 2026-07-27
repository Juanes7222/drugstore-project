import { Prisma } from '@pharmacy/database';
import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Numeric input shape accepted by `toDecimal`. `string` covers the
 * JSON-decoded POS payloads (where every number arrives as a string after
 * `JSON.parse`), and `number` covers the in-process DTO paths.
 */
type DecimalInput = string | number | Prisma.Decimal | null | undefined;

interface ToDecimalOptions {
  /** Field name to surface when `value` is missing or non-finite. */
  fieldName: string;
  /**
   * When `true`, `null`/`undefined` is replaced with `Prisma.Decimal(0)` instead
   * of throwing. Use for legitimately-optional amounts such as a discount that
   * may not exist for a given line.
   */
  allowMissing?: boolean;
}

/**
 * Convert a value coming from a sync payload (or a service DTO) into a
 * `Prisma.Decimal`, throwing a clear domain exception if the value is
 * missing, NaN, or non-finite.
 *
 * `new Prisma.Decimal(undefined)` throws `[DecimalError] Invalid argument:
 * undefined` from decimal.js — that is the exact failure mode that was
 * surfacing in the sync logs before this helper existed. Replace every
 * `new Prisma.Decimal(someFieldFromPayload)` with `toDecimal(someFieldFromPayload,
 * { fieldName: 'items[N].unitCost' })` at the boundary so a missing field
 * produces a `SYNC_PAYLOAD_VALIDATION` error pointing at the offending
 * location, not a raw decimal.js stack trace.
 */
export function toDecimal(value: DecimalInput, options: ToDecimalOptions): Prisma.Decimal {
  if (value === null || value === undefined) {
    if (options.allowMissing) return new Prisma.Decimal(0);
    throw new InvalidSyncDecimalException(options.fieldName);
  }
  if (value instanceof Prisma.Decimal) return value;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new InvalidSyncDecimalException(options.fieldName);
  }
  try {
    return new Prisma.Decimal(value as string | number);
  } catch {
    throw new InvalidSyncDecimalException(options.fieldName);
  }
}

/**
 * Domain exception thrown by `toDecimal` when a numeric sync field is missing
 * or non-numeric. Kept separate from `SyncPayloadValidationException` because
 * it is thrown deep inside service code (after the Zod boundary) when an
 * in-process DTO field is also missing — the same shape, different layer.
 */
class InvalidSyncDecimalException extends DomainException {
  constructor(fieldName: string) {
    super(
      'SYNC_PAYLOAD_VALIDATION',
      `Invalid sync payload — ${fieldName}: expected a finite number, got undefined or non-numeric value`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
