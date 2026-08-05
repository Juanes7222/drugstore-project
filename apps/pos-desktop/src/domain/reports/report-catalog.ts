/**
 * Local report catalog — every report the POS can run against the local
 * PGlite database.
 *
 * Each entry is a static `ReportDefinition` consumed by the UI sidebar,
 * the execution service, the export pipeline, and the schedule runner.
 * No code lives here; this file is the single source of truth for what
 * reports exist and how they are presented.
 *
 * The full list mirrors the functional scope in the original task brief
 * (18 reports, 4 phases).  Reports that the user cannot run are
 * automatically hidden by the sidebar through the `allowedRoles` field
 * and additionally blocked by the execution service.
 */

import { RoleType } from '@pharmacy/shared-types';
import {
  ReportCategory,
  ReportChartKind,
  ReportCode,
  ReportColumn,
  ReportColumnType,
  ReportDefinition,
} from './report-types';

// ---------------------------------------------------------------------------
// Default filter helpers
// ---------------------------------------------------------------------------

/** Build a `defaultFilters` object that uses the "this month" preset. */
const thisMonth = (): {
  preset: 'this_month';
  dateFrom: string;
  dateTo: string;
  comparePrevious: boolean;
} => {
  const now = new Date();
  const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    preset: 'this_month',
    dateFrom: toIsoDate(dateFrom),
    dateTo: toIsoDate(dateTo),
    comparePrevious: false,
  };
};

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

const col = (
  id: string,
  titleKey: string,
  type: ReportColumnType,
  align?: 'left' | 'right' | 'center',
  width?: number,
): ReportColumn => ({ id, titleKey, type, align, width });

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const REPORT_CATALOG: readonly ReportDefinition[] = [
  // -----------------------------------------------------------------------
  // Sales
  // -----------------------------------------------------------------------
  {
    code: ReportCode.SALES_DAILY_SUMMARY,
    titleKey: 'reports.catalog.sales_daily_summary.title',
    descriptionKey: 'reports.catalog.sales_daily_summary.description',
    category: ReportCategory.SALES,
    allowedRoles: [
      RoleType.CASHIER,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.LINE, dataZoom: true, showSummary: true },
    columns: [
      col('date', 'reports.cols.date', ReportColumnType.DATE, 'left'),
      col('transactionCount', 'reports.cols.transactions', ReportColumnType.INTEGER, 'right'),
      col('grossSales', 'reports.cols.gross_sales', ReportColumnType.CURRENCY, 'right'),
      col('discounts', 'reports.cols.discounts', ReportColumnType.CURRENCY, 'right'),
      col('taxes', 'reports.cols.taxes', ReportColumnType.CURRENCY, 'right'),
      col('returns', 'reports.cols.returns', ReportColumnType.CURRENCY, 'right'),
      col('annulled', 'reports.cols.annulled', ReportColumnType.INTEGER, 'right'),
      col('netSales', 'reports.cols.net_sales', ReportColumnType.CURRENCY, 'right'),
      col('deliveryCount', 'reports.cols.delivery_count', ReportColumnType.INTEGER, 'right'),
      col('deliveryFeeCollected', 'reports.cols.delivery_fee', ReportColumnType.CURRENCY, 'right'),
      col('totalCommission', 'reports.cols.total_commission', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 30_000,
  },
  {
    code: ReportCode.SALES_BY_CASHIER,
    titleKey: 'reports.catalog.sales_by_cashier.title',
    descriptionKey: 'reports.catalog.sales_by_cashier.description',
    category: ReportCategory.SALES,
    allowedRoles: [
      RoleType.CASHIER,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.BAR_HORIZONTAL, dataZoom: true, showSummary: true },
    columns: [
      col('cashierUserId', 'reports.cols.cashier', ReportColumnType.TEXT, 'left'),
      col('cashierName', 'reports.cols.cashier_name', ReportColumnType.TEXT, 'left'),
      col('transactionCount', 'reports.cols.transactions', ReportColumnType.INTEGER, 'right'),
      col('grossSales', 'reports.cols.gross_sales', ReportColumnType.CURRENCY, 'right'),
      col('returns', 'reports.cols.returns', ReportColumnType.CURRENCY, 'right'),
      col('netSales', 'reports.cols.net_sales', ReportColumnType.CURRENCY, 'right'),
      col('commissionAmount', 'reports.cols.commission_amount', ReportColumnType.CURRENCY, 'right'),
      col('averageTicket', 'reports.cols.average_ticket', ReportColumnType.CURRENCY, 'right'),
      col('totalVariance', 'reports.cols.variance', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 30_000,
  },
  {
    code: ReportCode.SALES_BY_PAYMENT_METHOD,
    titleKey: 'reports.catalog.sales_by_payment_method.title',
    descriptionKey: 'reports.catalog.sales_by_payment_method.description',
    category: ReportCategory.SALES,
    allowedRoles: [
      RoleType.CASHIER,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.DONUT, showSummary: true },
    columns: [
      col('paymentMethodId', 'reports.cols.payment_method_id', ReportColumnType.TEXT, 'left'),
      col('paymentMethodName', 'reports.cols.payment_method', ReportColumnType.TEXT, 'left'),
      col('transactionCount', 'reports.cols.transactions', ReportColumnType.INTEGER, 'right'),
      col('collected', 'reports.cols.collected', ReportColumnType.CURRENCY, 'right'),
      col('refunded', 'reports.cols.refunded', ReportColumnType.CURRENCY, 'right'),
      col('netCollected', 'reports.cols.net_collected', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 30_000,
  },
  {
    code: ReportCode.SALES_BY_PRODUCT,
    titleKey: 'reports.catalog.sales_by_product.title',
    descriptionKey: 'reports.catalog.sales_by_product.description',
    category: ReportCategory.SALES,
    allowedRoles: [
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
      RoleType.INVENTORY_ASSISTANT,
    ],
    defaultFilters: { ...thisMonth(), topN: 20 },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.BAR_HORIZONTAL, dataZoom: true, showSummary: true },
    columns: [
      col('rank', 'reports.cols.rank', ReportColumnType.INTEGER, 'right'),
      col('productId', 'reports.cols.product_id', ReportColumnType.TEXT, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('unitsSold', 'reports.cols.units_sold', ReportColumnType.INTEGER, 'right'),
      col('grossRevenue', 'reports.cols.gross_revenue', ReportColumnType.CURRENCY, 'right'),
      col('netRevenue', 'reports.cols.net_revenue', ReportColumnType.CURRENCY, 'right'),
      col('commissionAmount', 'reports.cols.commission_amount', ReportColumnType.CURRENCY, 'right'),
      col('contributionPercent', 'reports.cols.contribution', ReportColumnType.PERCENT, 'right'),
    ],
    cacheTtlMs: 60_000,
  },
  {
    code: ReportCode.SALES_BY_HOUR,
    titleKey: 'reports.catalog.sales_by_hour.title',
    descriptionKey: 'reports.catalog.sales_by_hour.description',
    category: ReportCategory.SALES,
    allowedRoles: [
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.AREA, dataZoom: true, showSummary: true },
    columns: [
      col('hour', 'reports.cols.hour', ReportColumnType.INTEGER, 'right'),
      col('transactionCount', 'reports.cols.transactions', ReportColumnType.INTEGER, 'right'),
      col('totalAmount', 'reports.cols.total', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 60_000,
  },
  {
    code: ReportCode.SALES_BY_WEEKDAY,
    titleKey: 'reports.catalog.sales_by_weekday.title',
    descriptionKey: 'reports.catalog.sales_by_weekday.description',
    category: ReportCategory.SALES,
    allowedRoles: [
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.BAR_VERTICAL, showSummary: true },
    columns: [
      col('weekday', 'reports.cols.weekday', ReportColumnType.TEXT, 'left'),
      col('transactionCount', 'reports.cols.transactions', ReportColumnType.INTEGER, 'right'),
      col('totalAmount', 'reports.cols.total', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 60_000,
  },

  // -----------------------------------------------------------------------
  // Inventory
  // -----------------------------------------------------------------------
  {
    code: ReportCode.INV_CURRENT_STOCK,
    titleKey: 'reports.catalog.inv_current_stock.title',
    descriptionKey: 'reports.catalog.inv_current_stock.description',
    category: ReportCategory.INVENTORY,
    allowedRoles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: {},
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.NONE },
    columns: [
      col('productId', 'reports.cols.product_id', ReportColumnType.TEXT, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('categoryName', 'reports.cols.category', ReportColumnType.TEXT, 'left'),
      col('laboratory', 'reports.cols.laboratory', ReportColumnType.TEXT, 'left'),
      col('cpp', 'reports.cols.cpp', ReportColumnType.CURRENCY, 'right'),
      col('salePrice', 'reports.cols.sale_price', ReportColumnType.CURRENCY, 'right'),
      col('stock', 'reports.cols.stock', ReportColumnType.INTEGER, 'right'),
      col('stockValue', 'reports.cols.stock_value', ReportColumnType.CURRENCY, 'right'),
      col('lowStock', 'reports.cols.low_stock', ReportColumnType.BADGE, 'center'),
    ],
    cacheTtlMs: 15_000,
  },
  {
    code: ReportCode.INV_EXPIRING_LOTS,
    titleKey: 'reports.catalog.inv_expiring_lots.title',
    descriptionKey: 'reports.catalog.inv_expiring_lots.description',
    category: ReportCategory.INVENTORY,
    allowedRoles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: { daysAhead: 60 },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.STACKED_BAR, showSummary: true },
    columns: [
      col('lotId', 'reports.cols.lot_id', ReportColumnType.TEXT, 'left'),
      col('batchNumber', 'reports.cols.batch_number', ReportColumnType.TEXT, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('quantity', 'reports.cols.quantity', ReportColumnType.INTEGER, 'right'),
      col('cpp', 'reports.cols.cpp', ReportColumnType.CURRENCY, 'right'),
      col('estimatedValue', 'reports.cols.estimated_value', ReportColumnType.CURRENCY, 'right'),
      col('expirationDate', 'reports.cols.expiration_date', ReportColumnType.DATE, 'left'),
      col('daysRemaining', 'reports.cols.days_remaining', ReportColumnType.INTEGER, 'right'),
    ],
    cacheTtlMs: 15_000,
  },
  {
    code: ReportCode.INV_EXPIRED_WITH_LOSS,
    titleKey: 'reports.catalog.inv_expired_with_loss.title',
    descriptionKey: 'reports.catalog.inv_expired_with_loss.description',
    category: ReportCategory.INVENTORY,
    allowedRoles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: {},
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.NONE },
    columns: [
      col('lotId', 'reports.cols.lot_id', ReportColumnType.TEXT, 'left'),
      col('batchNumber', 'reports.cols.batch_number', ReportColumnType.TEXT, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('quantity', 'reports.cols.quantity', ReportColumnType.INTEGER, 'right'),
      col('cpp', 'reports.cols.cpp', ReportColumnType.CURRENCY, 'right'),
      col('estimatedLoss', 'reports.cols.estimated_loss', ReportColumnType.CURRENCY, 'right'),
      col('expirationDate', 'reports.cols.expiration_date', ReportColumnType.DATE, 'left'),
    ],
    cacheTtlMs: 30_000,
  },
  {
    code: ReportCode.INV_ROTATION,
    titleKey: 'reports.catalog.inv_rotation.title',
    descriptionKey: 'reports.catalog.inv_rotation.description',
    category: ReportCategory.INVENTORY,
    allowedRoles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.SCATTER, showSummary: true },
    columns: [
      col('productId', 'reports.cols.product_id', ReportColumnType.TEXT, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('unitsSold', 'reports.cols.units_sold', ReportColumnType.INTEGER, 'right'),
      col('openingStock', 'reports.cols.opening_stock', ReportColumnType.INTEGER, 'right'),
      col('closingStock', 'reports.cols.closing_stock', ReportColumnType.INTEGER, 'right'),
      col('averageStock', 'reports.cols.average_stock', ReportColumnType.INTEGER, 'right'),
      col('rotationIndex', 'reports.cols.rotation_index', ReportColumnType.NUMBER, 'right'),
      col('daysOfInventory', 'reports.cols.days_of_inventory', ReportColumnType.NUMBER, 'right'),
    ],
    cacheTtlMs: 60_000,
  },
  {
    code: ReportCode.INV_LOW_MOVEMENT,
    titleKey: 'reports.catalog.inv_low_movement.title',
    descriptionKey: 'reports.catalog.inv_low_movement.description',
    category: ReportCategory.INVENTORY,
    allowedRoles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    defaultFilters: { daysWithoutMovement: 90 },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.BAR_HORIZONTAL, dataZoom: true, showSummary: true },
    columns: [
      col('productId', 'reports.cols.product_id', ReportColumnType.TEXT, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('stock', 'reports.cols.stock', ReportColumnType.INTEGER, 'right'),
      col('cpp', 'reports.cols.cpp', ReportColumnType.CURRENCY, 'right'),
      col('immobilizedValue', 'reports.cols.immobilized_value', ReportColumnType.CURRENCY, 'right'),
      col('lastMovement', 'reports.cols.last_movement', ReportColumnType.DATETIME, 'left'),
    ],
    cacheTtlMs: 60_000,
  },
  {
    code: ReportCode.INV_MOVEMENTS,
    titleKey: 'reports.catalog.inv_movements.title',
    descriptionKey: 'reports.catalog.inv_movements.description',
    category: ReportCategory.INVENTORY,
    allowedRoles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.STACKED_BAR, showSummary: true },
    columns: [
      col('movementId', 'reports.cols.movement_id', ReportColumnType.TEXT, 'left'),
      col('createdAt', 'reports.cols.date', ReportColumnType.DATETIME, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('batchNumber', 'reports.cols.batch_number', ReportColumnType.TEXT, 'left'),
      col('movementType', 'reports.cols.movement_type', ReportColumnType.BADGE, 'center'),
      col('quantity', 'reports.cols.quantity', ReportColumnType.INTEGER, 'right'),
      col('previousStock', 'reports.cols.previous_stock', ReportColumnType.INTEGER, 'right'),
      col('resultingStock', 'reports.cols.resulting_stock', ReportColumnType.INTEGER, 'right'),
      col('createdById', 'reports.cols.user', ReportColumnType.TEXT, 'left'),
    ],
    cacheTtlMs: 30_000,
  },

  // -----------------------------------------------------------------------
  // Fiscal & cash shift
  // -----------------------------------------------------------------------
  {
    code: ReportCode.FISCAL_TAX_SUMMARY,
    titleKey: 'reports.catalog.fiscal_tax_summary.title',
    descriptionKey: 'reports.catalog.fiscal_tax_summary.description',
    category: ReportCategory.FISCAL,
    allowedRoles: [
      RoleType.ACCOUNTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.BAR_VERTICAL, showSummary: true },
    columns: [
      col('taxType', 'reports.cols.tax_type', ReportColumnType.TEXT, 'left'),
      col('taxableBase', 'reports.cols.taxable_base', ReportColumnType.CURRENCY, 'right'),
      col('taxAmount', 'reports.cols.tax_amount', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 30_000,
  },
  {
    code: ReportCode.FISCAL_DIAN_DOCUMENTS,
    titleKey: 'reports.catalog.fiscal_dian_documents.title',
    descriptionKey: 'reports.catalog.fiscal_dian_documents.description',
    category: ReportCategory.FISCAL,
    allowedRoles: [
      RoleType.ACCOUNTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.DONUT, showSummary: true },
    columns: [
      col('invoiceId', 'reports.cols.invoice_id', ReportColumnType.TEXT, 'left'),
      col('invoiceNumber', 'reports.cols.invoice_number', ReportColumnType.TEXT, 'left'),
      col('invoiceType', 'reports.cols.invoice_type', ReportColumnType.TEXT, 'left'),
      col('issuedAt', 'reports.cols.issued_at', ReportColumnType.DATETIME, 'left'),
      col('status', 'reports.cols.status', ReportColumnType.BADGE, 'center'),
      col('cufe', 'reports.cols.cufe', ReportColumnType.TEXT, 'left'),
    ],
    cacheTtlMs: 30_000,
  },
  {
    code: ReportCode.CASH_SHIFT_CLOSE,
    titleKey: 'reports.catalog.cash_shift_close.title',
    descriptionKey: 'reports.catalog.cash_shift_close.description',
    category: ReportCategory.CASH_SHIFT,
    allowedRoles: [
      RoleType.CASHIER,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    defaultFilters: { shiftId: '' },
    exportFormats: ['pdf', 'excel', 'print'],
    chart: { kind: ReportChartKind.NONE },
    columns: [
      col('paymentMethodName', 'reports.cols.payment_method', ReportColumnType.TEXT, 'left'),
      col('expectedAmount', 'reports.cols.expected', ReportColumnType.CURRENCY, 'right'),
      col('declaredAmount', 'reports.cols.declared', ReportColumnType.CURRENCY, 'right'),
      col('difference', 'reports.cols.difference', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 0, // shift-close report is per-document, never cached
  },
  {
    code: ReportCode.AUDIT_SHIFT_VARIANCES,
    titleKey: 'reports.catalog.audit_shift_variances.title',
    descriptionKey: 'reports.catalog.audit_shift_variances.description',
    category: ReportCategory.CASH_SHIFT,
    allowedRoles: [
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.DIVERGING_BAR, showSummary: true },
    columns: [
      col('shiftId', 'reports.cols.shift_id', ReportColumnType.TEXT, 'left'),
      col('closedAt', 'reports.cols.closed_at', ReportColumnType.DATETIME, 'left'),
      col('cashierUserId', 'reports.cols.cashier', ReportColumnType.TEXT, 'left'),
      col('totalVariance', 'reports.cols.variance', ReportColumnType.CURRENCY, 'right'),
    ],
    cacheTtlMs: 30_000,
  },

  // -----------------------------------------------------------------------
  // Audit & profitability
  // -----------------------------------------------------------------------
  {
    code: ReportCode.AUDIT_TRACEABILITY,
    titleKey: 'reports.catalog.audit_traceability.title',
    descriptionKey: 'reports.catalog.audit_traceability.description',
    category: ReportCategory.AUDIT,
    allowedRoles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN, RoleType.ACCOUNTANT],
    defaultFilters: { ...thisMonth() },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.NONE },
    columns: [
      col('createdAt', 'reports.cols.date', ReportColumnType.DATETIME, 'left'),
      col('action', 'reports.cols.action', ReportColumnType.TEXT, 'left'),
      col('category', 'reports.cols.category', ReportColumnType.TEXT, 'left'),
      col('entityType', 'reports.cols.entity_type', ReportColumnType.TEXT, 'left'),
      col('entityId', 'reports.cols.entity_id', ReportColumnType.TEXT, 'left'),
      col('userId', 'reports.cols.user', ReportColumnType.TEXT, 'left'),
      col('userRole', 'reports.cols.role', ReportColumnType.TEXT, 'left'),
    ],
    cacheTtlMs: 15_000,
    requiresStepUp: true,
  },
  {
    code: ReportCode.PROFIT_MARGIN_BY_PRODUCT,
    titleKey: 'reports.catalog.profit_margin_by_product.title',
    descriptionKey: 'reports.catalog.profit_margin_by_product.description',
    category: ReportCategory.PROFITABILITY,
    allowedRoles: [
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
    ],
    defaultFilters: { ...thisMonth(), lowMarginPercent: 5 },
    exportFormats: ['pdf', 'excel', 'csv', 'print'],
    chart: { kind: ReportChartKind.SCATTER, showSummary: true },
    columns: [
      col('productId', 'reports.cols.product_id', ReportColumnType.TEXT, 'left'),
      col('productName', 'reports.cols.product', ReportColumnType.TEXT, 'left'),
      col('cpp', 'reports.cols.cpp', ReportColumnType.CURRENCY, 'right'),
      col('salePrice', 'reports.cols.sale_price', ReportColumnType.CURRENCY, 'right'),
      col('unitsSold', 'reports.cols.units_sold', ReportColumnType.INTEGER, 'right'),
      col('revenue', 'reports.cols.revenue', ReportColumnType.CURRENCY, 'right'),
      col('estimatedCost', 'reports.cols.estimated_cost', ReportColumnType.CURRENCY, 'right'),
      col('grossProfit', 'reports.cols.gross_profit', ReportColumnType.CURRENCY, 'right'),
      col('grossMarginPercent', 'reports.cols.gross_margin', ReportColumnType.PERCENT, 'right'),
      col('marginStatus', 'reports.cols.margin_status', ReportColumnType.BADGE, 'center'),
    ],
    cacheTtlMs: 60_000,
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Index `ReportDefinition` by code for O(1) lookup. */
const CATALOG_BY_CODE: Map<ReportCode, ReportDefinition> = new Map(
  REPORT_CATALOG.map((r) => [r.code, r]),
);

export function getReportDefinition(code: ReportCode): ReportDefinition {
  const def = CATALOG_BY_CODE.get(code);
  if (!def) throw new Error(`Unknown report code: ${code}`);
  return def;
}

export function listReportsForRole(role: string | null | undefined): readonly ReportDefinition[] {
  if (!role) return [];
  return REPORT_CATALOG.filter((r) => r.allowedRoles.includes(role as RoleType));
}

export function listReportsByCategory(
  role: string | null | undefined,
): ReadonlyMap<ReportCategory, readonly ReportDefinition[]> {
  const grouped = new Map<ReportCategory, ReportDefinition[]>();
  for (const def of listReportsForRole(role)) {
    const bucket = grouped.get(def.category) ?? [];
    bucket.push(def);
    grouped.set(def.category, bucket);
  }
  return grouped as ReadonlyMap<ReportCategory, readonly ReportDefinition[]>;
}
