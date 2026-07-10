/**
 * View mode for reports.
 *
 * `'fiscal'` — strict fiscal view using only immutable invoice data as submitted to DIAN.
 * `'operational'` — operational view that applies local invoice annotations (payment splits,
 * internal notes, contact changes, etc.) on top of the fiscal baseline.
 *
 * The operational view is resolved **only** on the POS terminal where the local adjustment
 * layer lives. On the server, both views produce identical data because the
 * `InvoiceLocalAdjustment` table does not exist in the server schema.
 */
export type ReportView = 'fiscal' | 'operational';
