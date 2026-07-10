/**
 * Response DTO for GET /reports/daily.
 *
 * Provides a day-by-day aggregation of CONFIRMED sales within a date range,
 * with totals, counts, and average ticket per day.
 */
export class DailyReportResponseDto {
  /** The date range this report covers. */
  reportPeriod!: {
    dateFrom: string;
    dateTo: string;
  };

  /** The view mode used for the report. */
  view!: 'fiscal' | 'operational';

  /** Total count of days in the period. */
  totalDays!: number;

  /** Aggregate totals across all days. */
  totals!: {
    totalSales: number;
    totalAmount: string;
    totalTax: string;
    totalQuantity: number;
    averageTicket: string;
  };

  /** Day-by-day breakdown. */
  dailyEntries!: Array<{
    /** ISO date string (YYYY-MM-DD) for the day. */
    date: string;
    /** Number of CONFIRMED sales on this day. */
    salesCount: number;
    /** Sum of sale totalAmount for this day. */
    totalAmount: string;
    /** Sum of totalTax for this day. */
    totalTax: string;
    /** Total quantity of items sold this day. */
    quantity: number;
    /** Average ticket (totalAmount / salesCount) for this day. */
    averageTicket: string;
  }>;
}
