/**
 * Data-export exceptions.
 *
 * Single error type for the export pipeline — render or save failures.
 * Dataset load failures surface as the domain services' own exceptions.
 */

import { DomainError } from '../../common/domain-error';

export class ExportException extends DomainError {
  constructor(
    message: string,
    errorCode = 'EXPORT_FAILED',
    readonly cause?: unknown,
  ) {
    super(errorCode, message);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}