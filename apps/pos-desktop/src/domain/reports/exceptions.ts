/**
 * Local report exceptions.
 *
 * Every report module error extends the shared `DomainError` base so the
 * UI can branch on `errorCode` rather than parsing strings.
 */

import { DomainError } from '../../common/domain-error';

/** The user is not allowed to run this report. */
export class ReportPermissionDeniedException extends DomainError {
  constructor(public readonly reportCode: string) {
    super(
      'REPORT_PERMISSION_DENIED',
      `Current role is not allowed to run report ${reportCode}.`,
    );
  }
}

/** The supplied date range is invalid (e.g. dateFrom > dateTo). */
export class ReportInvalidDateRangeException extends DomainError {
  constructor(dateFrom: string, dateTo: string) {
    super(
      'REPORT_INVALID_DATE_RANGE',
      `Invalid date range: from=${dateFrom} to=${dateTo}.`,
    );
  }
}

/** The supplied shift id does not exist locally. */
export class ReportShiftNotFoundException extends DomainError {
  constructor(public readonly shiftId: string) {
    super(
      'REPORT_SHIFT_NOT_FOUND',
      `Cash shift ${shiftId} not found locally.`,
    );
  }
}

/** Generic fallback for unexpected report errors. */
export class ReportExecutionException extends DomainError {
  constructor(public readonly reportCode: string, message: string) {
    super('REPORT_EXECUTION_FAILED', `Report ${reportCode} failed: ${message}`);
  }
}
