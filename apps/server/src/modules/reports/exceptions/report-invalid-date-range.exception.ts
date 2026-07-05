import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a report endpoint receives a date range where `dateFrom`
 * is later than `dateTo`.
 */
export class ReportInvalidDateRangeException extends DomainException {
  constructor(dateFrom: string, dateTo: string) {
    super(
      'REPORT_INVALID_DATE_RANGE',
      `Report date range is invalid: dateFrom (${dateFrom}) must not be after dateTo (${dateTo})`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
