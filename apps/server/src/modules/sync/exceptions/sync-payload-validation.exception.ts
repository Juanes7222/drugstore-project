import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a sync operation payload fails runtime schema validation.
 *
 * The dispatcher validates every supported operation type against a Zod
 * schema at the boundary so a malformed payload surfaces a clear,
 * field-level error rather than a raw `DecimalError: Invalid argument:
 * undefined` or a `TypeError` deep inside a service.
 */
export class SyncPayloadValidationException extends DomainException {
  constructor(operationType: string, issues: Array<{ field: string; message: string }>) {
    const detail = issues
      .map((i) => `${i.field}: ${i.message}`)
      .join('; ');
    // Message intentionally includes the word "validation" so
    // `classifyServerError` routes the failure to the `VALIDATION` bucket
    // in the SyncOperationOutcome health metric.
    super(
      'SYNC_PAYLOAD_VALIDATION',
      `Sync payload validation failed for ${operationType} — ${detail}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
