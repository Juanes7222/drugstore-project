/**
 * Local report permissions — enforces role-based access *before* a report
 * query runs.
 *
 * The sidebar already filters by role, but the execution service MUST
 * enforce independently.  A misconfigured UI is not a security boundary.
 */

import { RoleType } from '@pharmacy/shared-types';
import { getReportDefinition } from './report-catalog';
import { ReportCode } from './report-types';
import { ReportPermissionDeniedException } from './exceptions';

const CASHIER_ALLOWED: readonly ReportCode[] = [
  ReportCode.SALES_DAILY_SUMMARY,
  ReportCode.SALES_BY_PAYMENT_METHOD,
  ReportCode.CASH_SHIFT_CLOSE,
];

/**
 * Cashier is further restricted to their own sales and shifts.  This is
 * enforced by filtering inside the query builders (`restrictToOwnSales`)
 * rather than blocking the report entirely.
 */
export function isCashierScopedReport(code: ReportCode): boolean {
  return CASHIER_ALLOWED.includes(code) || code === ReportCode.SALES_BY_CASHIER;
}

/**
 * Throws `ReportPermissionDeniedException` when the current role cannot
 * run the report.  Returns silently when the role is allowed.
 */
export function assertReportAccess(code: ReportCode, role: string | null | undefined): void {
  if (!role) throw new ReportPermissionDeniedException(code);
  const def = getReportDefinition(code);
  const roleEnum = role as RoleType;
  if (!def.allowedRoles.includes(roleEnum)) {
    throw new ReportPermissionDeniedException(code);
  }
}

/**
 * For cashier-scoped reports, returns the userId to restrict the query to.
 * Returns `undefined` for privileged roles, meaning no restriction.
 */
export function resolveCashierScope(
  code: ReportCode,
  role: string | null | undefined,
  sessionUserId: string | null,
): string | undefined {
  if (role === RoleType.OWNER || role === RoleType.SAAS_ADMIN || role === RoleType.MANAGER) {
    return undefined;
  }
  if (role === RoleType.CASHIER && isCashierScopedReport(code)) {
    return sessionUserId ?? undefined;
  }
  return undefined;
}
