import { FiscalDocumentState, FiscalDocumentType } from '@pharmacy/shared-types';

/**
 * Response DTO for GET /reports/fiscal.
 *
 * Aggregates fiscal document activity within a date range, broken down
 * by document type and fiscal state.
 */
export class FiscalReportResponseDto {
  /** The date range this report covers. */
  reportPeriod!: {
    dateFrom: string;
    dateTo: string;
  };

  /** The view mode used for the report. */
  view!: 'fiscal' | 'operational';

  /** Total count of fiscal documents in the period. */
  totalDocuments!: number;

  /** Sum of subtotals across all documents. */
  totalSubtotal!: string;

  /** Sum of taxes across all documents. */
  totalTax!: string;

  /** Grand total (subtotal + tax). */
  totalAmount!: string;

  /** Breakdown by fiscal document type. */
  breakdownByType!: Array<{
    documentType: FiscalDocumentType;
    count: number;
    totalAmount: string;
    states: Array<{
      state: FiscalDocumentState;
      count: number;
    }>;
  }>;
}
