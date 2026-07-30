/**
 * Local reports module — type definitions.
 *
 * Every report the POS can render against its local PGlite database is
 * described here.  The shape is intentionally framework-free so the same
 * types can be reused by the execution service, the React UI, and the
 * export pipeline.
 *
 * ## Conventions
 * - `ReportCode` is the stable identifier — never rename an entry, only
 *   add new ones.  UI components filter and look up by code.
 * - All monetary values are COP strings in the same precision the
 *   database stores (Decimal(15, 2)).  We do NOT round at the boundary;
 *   the UI formatter is the single place that applies the es-CO rules.
 * - `warnings` is non-empty when the report ran with caveats (e.g.
 *   partial local sync, missing master data).  Never use it for errors
 *   that prevent a report from running — those throw domain errors.
 */

import { RoleType } from '@pharmacy/shared-types';
import { MovementType, SaleOperationalState, ShiftState } from '@pharmacy/database/local';

// ---------------------------------------------------------------------------
// Report codes
// ---------------------------------------------------------------------------

/** Every report the POS can render locally. */
export const ReportCode = {
  SALES_DAILY_SUMMARY: 'SALES_DAILY_SUMMARY',
  SALES_BY_CASHIER: 'SALES_BY_CASHIER',
  SALES_BY_PAYMENT_METHOD: 'SALES_BY_PAYMENT_METHOD',
  SALES_BY_PRODUCT: 'SALES_BY_PRODUCT',
  SALES_BY_HOUR: 'SALES_BY_HOUR',
  SALES_BY_WEEKDAY: 'SALES_BY_WEEKDAY',

  INV_CURRENT_STOCK: 'INV_CURRENT_STOCK',
  INV_EXPIRING_LOTS: 'INV_EXPIRING_LOTS',
  INV_EXPIRED_WITH_LOSS: 'INV_EXPIRED_WITH_LOSS',
  INV_ROTATION: 'INV_ROTATION',
  INV_LOW_MOVEMENT: 'INV_LOW_MOVEMENT',
  INV_MOVEMENTS: 'INV_MOVEMENTS',

  FISCAL_TAX_SUMMARY: 'FISCAL_TAX_SUMMARY',
  FISCAL_DIAN_DOCUMENTS: 'FISCAL_DIAN_DOCUMENTS',
  CASH_SHIFT_CLOSE: 'CASH_SHIFT_CLOSE',
  AUDIT_SHIFT_VARIANCES: 'AUDIT_SHIFT_VARIANCES',

  AUDIT_TRACEABILITY: 'AUDIT_TRACEABILITY',
  PROFIT_MARGIN_BY_PRODUCT: 'PROFIT_MARGIN_BY_PRODUCT',
} as const;

export type ReportCode = (typeof ReportCode)[keyof typeof ReportCode];

export const ALL_REPORT_CODES: readonly ReportCode[] = Object.values(ReportCode);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const ReportCategory = {
  SALES: 'sales',
  INVENTORY: 'inventory',
  FISCAL: 'fiscal',
  CASH_SHIFT: 'cash_shift',
  AUDIT: 'audit',
  PROFITABILITY: 'profitability',
} as const;

export type ReportCategory = (typeof ReportCategory)[keyof typeof ReportCategory];

// ---------------------------------------------------------------------------
// Filter shapes
// ---------------------------------------------------------------------------

/** Date preset options exposed in the UI. */
export const ReportDatePreset = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  THIS_WEEK: 'this_week',
  THIS_MONTH: 'this_month',
  LAST_MONTH: 'last_month',
  CUSTOM: 'custom',
} as const;

export type ReportDatePreset =
  (typeof ReportDatePreset)[keyof typeof ReportDatePreset];

/**
 * Common date range filter present on every report.  Dates are ISO 8601
 * strings (`YYYY-MM-DD`) interpreted as Colombia local dates by the
 * execution service.
 */
export interface DateRangeFilter {
  preset: ReportDatePreset;
  /** ISO 8601 date string.  Always set, even for presets. */
  dateFrom: string;
  /** ISO 8601 date string.  Always set, even for presets. */
  dateTo: string;
  /** When true, the report is computed twice: once for the selected range
   *  and once for the immediately preceding equal-length range, with
   *  per-KPI deltas. */
  comparePrevious: boolean;
}

export interface SalesFilters extends DateRangeFilter {
  cashierUserId?: string;
  paymentMethodId?: string;
  categoryId?: string;
  productId?: string;
}

export interface CashierSalesFilters extends DateRangeFilter {
  /** When omitted, the report auto-scopes to the current cashier session. */
  cashierUserId?: string;
}

export interface PaymentMethodFilters extends DateRangeFilter {
  paymentMethodId?: string;
}

export interface ProductSalesFilters extends DateRangeFilter {
  categoryId?: string;
  /** Top-N cap.  Defaults to 20. */
  topN?: number;
}

export interface HourFilters extends DateRangeFilter {}

export interface WeekdayFilters extends DateRangeFilter {}

export interface CurrentStockFilters {
  categoryId?: string;
  laboratory?: string;
  productId?: string;
  /** When true, include lots with stock=0 and state=EXPIRED/BLOCKED. */
  includeInactive?: boolean;
}

export interface ExpiringLotsFilters {
  /** Days remaining until expiration.  Defaults to 60. */
  daysAhead: number;
  categoryId?: string;
  productId?: string;
}

export interface ExpiredWithLossFilters {
  categoryId?: string;
  productId?: string;
}

export interface RotationFilters extends DateRangeFilter {
  categoryId?: string;
  productId?: string;
}

export interface LowMovementFilters {
  /** Days without movement.  Defaults to 90. */
  daysWithoutMovement: number;
  categoryId?: string;
}

export interface InventoryMovementsFilters extends DateRangeFilter {
  productId?: string;
  lotId?: string;
  movementType?: MovementType;
  userId?: string;
}

export interface FiscalTaxSummaryFilters extends DateRangeFilter {}

export interface FiscalDianDocumentsFilters extends DateRangeFilter {
  status?: string;
  invoiceType?: string;
}

export interface CashShiftCloseFilters {
  shiftId: string;
}

export interface AuditShiftVariancesFilters extends DateRangeFilter {
  cashierUserId?: string;
}

export interface AuditTraceabilityFilters extends DateRangeFilter {
  userId?: string;
  category?: string;
  actionPrefix?: string;
}

export interface ProfitMarginFilters extends DateRangeFilter {
  categoryId?: string;
  /** Margin threshold for the "low margin" flag, in percent.  Defaults to 5. */
  lowMarginPercent: number;
  productId?: string;
}

export type ReportFilters =
  | { code: typeof ReportCode.SALES_DAILY_SUMMARY; filters: SalesFilters }
  | { code: typeof ReportCode.SALES_BY_CASHIER; filters: CashierSalesFilters }
  | { code: typeof ReportCode.SALES_BY_PAYMENT_METHOD; filters: PaymentMethodFilters }
  | { code: typeof ReportCode.SALES_BY_PRODUCT; filters: ProductSalesFilters }
  | { code: typeof ReportCode.SALES_BY_HOUR; filters: HourFilters }
  | { code: typeof ReportCode.SALES_BY_WEEKDAY; filters: WeekdayFilters }
  | { code: typeof ReportCode.INV_CURRENT_STOCK; filters: CurrentStockFilters }
  | { code: typeof ReportCode.INV_EXPIRING_LOTS; filters: ExpiringLotsFilters }
  | { code: typeof ReportCode.INV_EXPIRED_WITH_LOSS; filters: ExpiredWithLossFilters }
  | { code: typeof ReportCode.INV_ROTATION; filters: RotationFilters }
  | { code: typeof ReportCode.INV_LOW_MOVEMENT; filters: LowMovementFilters }
  | { code: typeof ReportCode.INV_MOVEMENTS; filters: InventoryMovementsFilters }
  | { code: typeof ReportCode.FISCAL_TAX_SUMMARY; filters: FiscalTaxSummaryFilters }
  | { code: typeof ReportCode.FISCAL_DIAN_DOCUMENTS; filters: FiscalDianDocumentsFilters }
  | { code: typeof ReportCode.CASH_SHIFT_CLOSE; filters: CashShiftCloseFilters }
  | { code: typeof ReportCode.AUDIT_SHIFT_VARIANCES; filters: AuditShiftVariancesFilters }
  | { code: typeof ReportCode.AUDIT_TRACEABILITY; filters: AuditTraceabilityFilters }
  | { code: typeof ReportCode.PROFIT_MARGIN_BY_PRODUCT; filters: ProfitMarginFilters };

/** Helper to extract filters from a ReportFilters discriminated union. */
export type FiltersFor<C extends ReportCode> = Extract<ReportFilters, { code: C }>['filters'];

// ---------------------------------------------------------------------------
// Chart configuration
// ---------------------------------------------------------------------------

export const ReportChartKind = {
  NONE: 'none',
  LINE: 'line',
  AREA: 'area',
  BAR_HORIZONTAL: 'bar_horizontal',
  BAR_VERTICAL: 'bar_vertical',
  STACKED_BAR: 'stacked_bar',
  DONUT: 'donut',
  SCATTER: 'scatter',
  GAUGE: 'gauge',
  DIVERGING_BAR: 'diverging_bar',
} as const;

export type ReportChartKind = (typeof ReportChartKind)[keyof typeof ReportChartKind];

export interface ReportChartConfig {
  kind: ReportChartKind;
  /** Whether the chart should expose a dataZoom control. */
  dataZoom?: boolean;
  /** When true, render a textual summary alongside the chart for a11y. */
  showSummary?: boolean;
}

// ---------------------------------------------------------------------------
// Table columns
// ---------------------------------------------------------------------------

export const ReportColumnType = {
  TEXT: 'text',
  NUMBER: 'number',
  CURRENCY: 'currency',
  PERCENT: 'percent',
  DATE: 'date',
  DATETIME: 'datetime',
  INTEGER: 'integer',
  BADGE: 'badge',
} as const;

export type ReportColumnType = (typeof ReportColumnType)[keyof typeof ReportColumnType];

export interface ReportColumn {
  /** Stable id used for sort/filter lookups. */
  id: string;
  /** i18n key for the header. */
  titleKey: string;
  type: ReportColumnType;
  /** Right-align numerics by default. */
  align?: 'left' | 'right' | 'center';
  /** Optional fixed width, in characters. */
  width?: number;
}

// ---------------------------------------------------------------------------
// Report definition
// ---------------------------------------------------------------------------

export type ReportExportFormat = 'pdf' | 'excel' | 'csv' | 'print';

export interface ReportDefinition {
  code: ReportCode;
  /** i18n key for the report title. */
  titleKey: string;
  /** i18n key for the report description (1–2 lines). */
  descriptionKey: string;
  category: ReportCategory;
  /** Roles allowed to execute this report. */
  allowedRoles: readonly RoleType[];
  /** Default filters applied when the user opens the report for the first time. */
  defaultFilters: DateRangeFilter | Record<string, unknown>;
  /** Export formats this report supports. */
  exportFormats: readonly ReportExportFormat[];
  chart: ReportChartConfig;
  columns: readonly ReportColumn[];
  /** Cache TTL in milliseconds.  0 disables caching. */
  cacheTtlMs: number;
  /** When true, requires a step-up authentication before the report can run. */
  requiresStepUp?: boolean;
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------

export const ReportKpiTone = {
  NEUTRAL: 'neutral',
  POSITIVE: 'positive',
  WARNING: 'warning',
  DANGER: 'danger',
  BRAND: 'brand',
} as const;

export type ReportKpiTone = (typeof ReportKpiTone)[keyof typeof ReportKpiTone];

export interface ReportKpi {
  id: string;
  titleKey: string;
  /** Raw value (number, string, or null when not applicable). */
  value: string | number | null;
  /** Optional value from the previous comparable period. */
  previousValue?: string | number | null;
  /** Optional unit suffix (i18n key, e.g. "common.units.cop"). */
  unitKey?: string;
  /** Optional tone override. */
  tone?: ReportKpiTone;
  /** Optional helper-text i18n key for additional context. */
  helperKey?: string;
}

// ---------------------------------------------------------------------------
// Local freshness metadata
// ---------------------------------------------------------------------------

export interface ReportFreshness {
  /** "local-workstation" — always, for this module. */
  dataSource: 'local-workstation';
  /** ISO 8601 timestamp of when the report was generated. */
  generatedAt: string;
  /** ISO 8601 timestamp of the last successful catalog pull, or null. */
  lastSyncAt: string | null;
  /** Number of SyncQueue rows still pending. */
  pendingOperations: number;
  /** Number of SyncQueue rows in a permanent failure state. */
  permanentFailures: number;
  /** True when the most recent sync attempt was successful. */
  lastSyncSuccessful: boolean;
  /** Database revision cursor (max `clientSequence` applied) used to invalidate caches. */
  dbRevision: string;
}

// ---------------------------------------------------------------------------
// Common warning shape
// ---------------------------------------------------------------------------

export interface ReportWarning {
  code: string;
  messageKey: string;
  /** Optional structured payload translated by the UI. */
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Discriminated response envelope
// ---------------------------------------------------------------------------

export type AnyReportRow = Record<string, unknown>;

export interface ReportResponseBase {
  code: ReportCode;
  generatedAt: string;
  freshness: ReportFreshness;
  warnings: ReportWarning[];
  /** Wall-clock execution time in milliseconds. */
  executionMs: number;
  /** Whether the result was served from cache. */
  fromCache: boolean;
  filters: DateRangeFilter;
  kpis: ReportKpi[];
  /** Chart series in ECharts-friendly shape (raw data only — the
   *  renderer maps these to options via the chart-option factories). */
  chart: { kind: ReportChartKind; series: unknown; xAxis?: unknown; yAxis?: unknown };
  /** Paginated detail table data. */
  rows: AnyReportRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface ReportResponse extends ReportResponseBase {
  code: ReportCode;
}

// ---------------------------------------------------------------------------
// Domain re-exports — keep a single import surface for the consumer side
// ---------------------------------------------------------------------------

export { SaleOperationalState, ShiftState, MovementType };
