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

/** The report is gated by a purchases-config flag that is not enabled. */
export class ReportConfigDisabledException extends DomainError {
  constructor(
    public readonly reportCode: string,
    public readonly messageKey = 'reports.error.config_disabled',
  ) {
    super(
      'REPORT_CONFIG_DISABLED',
      `Report ${reportCode} requires a purchases config flag that is not enabled.`,
    );
  }
}

/**
 * A required filter has not been selected yet (e.g. CASH_SHIFT_CLOSE
 * without a shift picked).  Not a failure — the UI should prompt the
 * user to complete the filter instead of rendering an error state.
 */
export class ReportFiltersNotReadyException extends DomainError {
  constructor(
    public readonly reportCode: string,
    public readonly messageKey = 'reports.filters.select_shift',
    public readonly params: Record<string, string | number> = {},
  ) {
    super(
      'REPORT_FILTERS_NOT_READY',
      `Report ${reportCode} cannot run: a required filter is not selected yet (${messageKey}).`,
    );
  }
}
