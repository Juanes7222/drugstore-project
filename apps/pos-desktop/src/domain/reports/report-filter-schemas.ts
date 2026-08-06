/**
 * Local report filter schemas (Zod) and validation.
 *
 * Every public entry point validates filters at the boundary.  The query
 * builders trust their inputs and never re-validate.
 *
 * The same Zod schemas are used at runtime by the React filter panel and
 * by the export service.  Unit tests assert that:
 *  - valid presets pass,
 *  - `dateFrom > dateTo` raises `REPORT_INVALID_DATE_RANGE`,
 *  - unknown fields are rejected,
 *  - defaults fill in correctly.
 *
 * All Zod error messages carry i18n keys.  Callers that provide a `t`
 * function to `validateFilters` receive translated messages; callers
 * that omit it see the raw key string (which functions as a developer
 * hint).
 */

import { z } from 'zod';
import {
  DateRangeFilter,
  FiltersFor,
  ReportCode,
  ReportDatePreset,
} from './report-types';
import { ReportInvalidDateRangeException } from './exceptions';
import { MovementType, SaleOperationalState } from '@pharmacy/database/local';

// ---------------------------------------------------------------------------
// Translation type & key map
// ---------------------------------------------------------------------------

/** Minimal translate function shape accepted by validation helpers. */
export type TranslateFn = (key: string, fallback?: string) => string;

/** Maps i18n keys back to English fallback messages for backward compat
 *  and for developers reading Zod errors in dev. */
const ZOD_MSG_FALLBACK: Record<string, string> = {
  'reports.validation.iso_date_format': 'Expected YYYY-MM-DD',
  'reports.validation.date_range_invalid': 'dateFrom must be <= dateTo',
};

// ---------------------------------------------------------------------------
// Schemas (messages use i18n keys)
// ---------------------------------------------------------------------------

const PRESET_VALUES = Object.values(ReportDatePreset) as [
  ReportDatePreset,
  ...ReportDatePreset[],
];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'reports.validation.iso_date_format');

export const dateRangeFilterSchema = z
  .object({
    preset: z.enum(PRESET_VALUES),
    dateFrom: isoDate,
    dateTo: isoDate,
    comparePrevious: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.dateFrom > val.dateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reports.validation.date_range_invalid',
      });
    }
  });

// ---------------------------------------------------------------------------
// Per-report schemas
// ---------------------------------------------------------------------------

const salesFilters = dateRangeFilterSchema.extend({
  cashierUserId: z.string().min(1).optional(),
  paymentMethodId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});

const cashierSalesFilters = dateRangeFilterSchema.extend({
  cashierUserId: z.string().min(1).optional(),
});

const paymentMethodFilters = dateRangeFilterSchema.extend({
  paymentMethodId: z.string().min(1).optional(),
});

const productSalesFilters = dateRangeFilterSchema.extend({
  categoryId: z.string().min(1).optional(),
  topN: z.number().int().positive().max(500).optional(),
});

const hourFilters = dateRangeFilterSchema;
const weekdayFilters = dateRangeFilterSchema;

const currentStockFilters = z.object({
  categoryId: z.string().min(1).optional(),
  laboratory: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  includeInactive: z.boolean().optional(),
});

const expiringLotsFilters = z.object({
  daysAhead: z.number().int().positive().max(730),
  categoryId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});

const expiredWithLossFilters = z.object({
  categoryId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});

const rotationFilters = dateRangeFilterSchema.extend({
  categoryId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});

const lowMovementFilters = z.object({
  daysWithoutMovement: z.number().int().positive().max(730),
  categoryId: z.string().min(1).optional(),
});

const MOVEMENT_TYPES = Object.values(MovementType) as [string, ...string[]];

const inventoryMovementsFilters = dateRangeFilterSchema.extend({
  productId: z.string().min(1).optional(),
  lotId: z.string().min(1).optional(),
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  userId: z.string().min(1).optional(),
});

const fiscalTaxSummaryFilters = dateRangeFilterSchema;

const cashShiftCloseFilters = z.object({
  shiftId: z.string().min(1),
});

const auditShiftVariancesFilters = dateRangeFilterSchema;

const profitMarginFilters = dateRangeFilterSchema.extend({
  categoryId: z.string().min(1).optional(),
  lowMarginPercent: z.number().nonnegative().max(100),
  productId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Public validation entry
// ---------------------------------------------------------------------------

const FILTERS_BY_REPORT: {
  [K in ReportCode]: z.ZodType<unknown>;
} = {
  [ReportCode.SALES_DAILY_SUMMARY]: salesFilters,
  [ReportCode.SALES_BY_CASHIER]: cashierSalesFilters,
  [ReportCode.SALES_BY_PAYMENT_METHOD]: paymentMethodFilters,
  [ReportCode.SALES_BY_PRODUCT]: productSalesFilters,
  [ReportCode.SALES_BY_HOUR]: hourFilters,
  [ReportCode.SALES_BY_WEEKDAY]: weekdayFilters,
  [ReportCode.INV_CURRENT_STOCK]: currentStockFilters,
  [ReportCode.INV_STOCK_BY_CATEGORY]: currentStockFilters,
  [ReportCode.INV_EXPIRING_LOTS]: expiringLotsFilters,
  [ReportCode.INV_EXPIRED_WITH_LOSS]: expiredWithLossFilters,
  [ReportCode.INV_ROTATION]: rotationFilters,
  [ReportCode.INV_LOW_MOVEMENT]: lowMovementFilters,
  [ReportCode.INV_MOVEMENTS]: inventoryMovementsFilters,
  [ReportCode.FISCAL_TAX_SUMMARY]: fiscalTaxSummaryFilters,
  [ReportCode.CASH_SHIFT_CLOSE]: cashShiftCloseFilters,
  [ReportCode.AUDIT_SHIFT_VARIANCES]: auditShiftVariancesFilters,
  [ReportCode.PROFIT_MARGIN_BY_PRODUCT]: profitMarginFilters,
};

/**
 * Validate and normalize the raw filter input for a report.  Throws
 * `ReportInvalidDateRangeException` when the date range is invalid.
 * Throws `ZodError` when the shape is wrong.
 *
 * When a `t` function is provided, Zod error messages are translated
 * via the key map.  When omitted, the raw i18n key is used (backward
 * compatible for callers that catch `ZodError` and handle translation
 * themselves).
 */
export function validateFilters<C extends ReportCode>(
  code: C,
  raw: unknown,
  t?: TranslateFn,
): FiltersFor<C> {
  const schema = FILTERS_BY_REPORT[code];
  try {
    const parsed = schema.parse(raw) as FiltersFor<C>;
    // Double-check the date range explicitly so we can throw our domain error
    // rather than the generic Zod one — the UI has a specific message for it.
    const f = parsed as { dateFrom?: string; dateTo?: string };
    if (f.dateFrom && f.dateTo && f.dateFrom > f.dateTo) {
      throw new ReportInvalidDateRangeException(f.dateFrom, f.dateTo);
    }
    return parsed;
  } catch (err) {
    // Translate Zod error messages when t is available.
    if (err instanceof z.ZodError && t) {
      const translatedIssues = err.issues.map((issue) => {
        const key = issue.message;
        const fallback = ZOD_MSG_FALLBACK[key] ?? key;
        return { ...issue, message: t(key, fallback) };
      });
      throw new z.ZodError(translatedIssues);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Date-preset resolver
// ---------------------------------------------------------------------------

/** Resolve a preset to a concrete date range in Colombia local time. */
export function resolvePresetDates(
  preset: ReportDatePreset,
  customFrom?: string,
  customTo?: string,
): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  if (preset === ReportDatePreset.TODAY) {
    return { dateFrom: todayIso, dateTo: todayIso };
  }
  if (preset === ReportDatePreset.YESTERDAY) {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yIso = y.toISOString().slice(0, 10);
    return { dateFrom: yIso, dateTo: yIso };
  }
  if (preset === ReportDatePreset.THIS_WEEK) {
    const start = new Date(now);
    // Week starts Monday in Colombia.
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow);
    return { dateFrom: start.toISOString().slice(0, 10), dateTo: todayIso };
  }
  if (preset === ReportDatePreset.THIS_MONTH) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: start.toISOString().slice(0, 10), dateTo: todayIso };
  }
  if (preset === ReportDatePreset.LAST_MONTH) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      dateFrom: start.toISOString().slice(0, 10),
      dateTo: end.toISOString().slice(0, 10),
    };
  }
  if (preset === ReportDatePreset.CUSTOM) {
    if (!customFrom || !customTo) {
      throw new ReportInvalidDateRangeException(
        customFrom ?? '',
        customTo ?? '',
      );
    }
    if (customFrom > customTo) {
      throw new ReportInvalidDateRangeException(customFrom, customTo);
    }
    return { dateFrom: customFrom, dateTo: customTo };
  }
  return { dateFrom: todayIso, dateTo: todayIso };
}

/** Compute the immediately preceding range of the same length. */
export function computePreviousRange(
  dateFrom: string,
  dateTo: string,
): { dateFrom: string; dateTo: string } {
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T00:00:00Z`);
  const days = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  );
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return {
    dateFrom: prevFrom.toISOString().slice(0, 10),
    dateTo: prevTo.toISOString().slice(0, 10),
  };
}

/** Type guard for `DateRangeFilter` (used by tests). */
export function isDateRangeFilter(value: unknown): value is DateRangeFilter {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.preset === 'string' &&
    typeof r.dateFrom === 'string' &&
    typeof r.dateTo === 'string' &&
    typeof r.comparePrevious === 'boolean'
  );
}

// Re-export for callers that prefer a single import.
export { SaleOperationalState };
