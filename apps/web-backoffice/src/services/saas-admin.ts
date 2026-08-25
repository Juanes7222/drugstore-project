import { api } from "./api";
import type {
  SaasAdminAccessAuditResponse,
  SaasAdminAtRiskRow,
  SaasAdminCustomerDashboard,
  SaasAdminCustomerPaymentsResponse,
  SaasAdminCustomerRow,
  SaasAdminCustomersResponse,
  SaasAdminFraudAlertsResponse,
  SaasAdminFiscalStatusResponse,
  SaasAdminLifecycleResult,
  SaasAdminPlanOption,
  SaasAdminRevenueResult,
  SaasAdminSalesResponse,
  SaasAdminSessionsResponse,
  SaasAdminTrialsEndingResult,
  SaasAdminUsersResponse,
  SaasAdminWorkstationsResponse,
  PlatformOverviewResult,
} from "../types/saas-admin";
import type { SalesFilters } from "./backoffice";

// ---------------------------------------------------------------------------
// Platform-owner endpoints (/saas-admin). The server enforces the
// SAAS_ADMIN role AND a database-backed isPlatformAdmin flag on every route.
// ---------------------------------------------------------------------------

export async function fetchPlatformOverview(): Promise<PlatformOverviewResult> {
  const { data } = await api.get<PlatformOverviewResult>("/saas-admin/platform-overview");
  return data;
}

export async function fetchSaasCustomers(
  page: number,
  pageSize: number,
  query?: string,
): Promise<SaasAdminCustomersResponse> {
  const { data } = await api.get<SaasAdminCustomersResponse>(
    "/saas-admin/customers",
    { params: { page, pageSize, query: query || undefined } },
  );
  return data;
}

export async function fetchSaasCustomer(id: string): Promise<SaasAdminCustomerRow> {
  const { data } = await api.get<SaasAdminCustomerRow>(`/saas-admin/customers/${id}`);
  return data;
}

export async function fetchSaasCustomerDashboard(
  id: string,
): Promise<SaasAdminCustomerDashboard> {
  const { data } = await api.get<SaasAdminCustomerDashboard>(
    `/saas-admin/customers/${id}/dashboard`,
  );
  return data;
}

export async function fetchSaasCustomerSales(
  id: string,
  filters: SalesFilters,
  page: number,
  pageSize: number,
): Promise<SaasAdminSalesResponse> {
  const { data } = await api.get<SaasAdminSalesResponse>(
    `/saas-admin/customers/${id}/sales`,
    { params: { ...filters, page, pageSize } },
  );
  return data;
}

export async function fetchSaasCustomerUsers(
  id: string,
): Promise<SaasAdminUsersResponse> {
  const { data } = await api.get<SaasAdminUsersResponse>(
    `/saas-admin/customers/${id}/users`,
  );
  return data;
}

export async function fetchSaasCustomerSessions(
  id: string,
  page: number,
  pageSize: number,
): Promise<SaasAdminSessionsResponse> {
  const { data } = await api.get<SaasAdminSessionsResponse>(
    `/saas-admin/customers/${id}/sessions`,
    { params: { page, pageSize } },
  );
  return data;
}

export async function fetchSaasCustomerWorkstations(
  id: string,
): Promise<SaasAdminWorkstationsResponse> {
  const { data } = await api.get<SaasAdminWorkstationsResponse>(
    `/saas-admin/customers/${id}/workstations`,
  );
  return data;
}

export async function fetchSaasCustomerFiscalStatus(
  id: string,
  from?: string,
): Promise<SaasAdminFiscalStatusResponse> {
  const { data } = await api.get<SaasAdminFiscalStatusResponse>(
    `/saas-admin/customers/${id}/fiscal-status`,
    { params: from ? { from } : undefined },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Fraud queue, platform audit, trials
// ---------------------------------------------------------------------------

/** Absent status = unresolved queue; "ALL" disables server filtering. */
export type FraudAlertsFilter = "" | "ALL" | string;

export async function fetchSaasFraudAlerts(
  page: number,
  pageSize: number,
  status: FraudAlertsFilter = "",
): Promise<SaasAdminFraudAlertsResponse> {
  const { data } = await api.get<SaasAdminFraudAlertsResponse>(
    "/saas-admin/fraud-alerts",
    { params: { page, pageSize, status: status || undefined } },
  );
  return data;
}

export interface ResolveFraudAlertInput {
  alertId: string;
  note?: string;
}

export async function resolveSaasFraudAlert(
  input: ResolveFraudAlertInput,
): Promise<void> {
  await api.post(`/saas-admin/fraud-alerts/${input.alertId}/resolve`, {
    note: input.note || undefined,
  });
}

export async function fetchSaasAccessAudit(
  page: number,
  pageSize: number,
): Promise<SaasAdminAccessAuditResponse> {
  const { data } = await api.get<SaasAdminAccessAuditResponse>(
    "/saas-admin/access-audit",
    { params: { page, pageSize } },
  );
  return data;
}

export async function fetchSaasTrialsEnding(
  days = 14,
): Promise<SaasAdminTrialsEndingResult> {
  const { data } = await api.get<SaasAdminTrialsEndingResult>(
    "/saas-admin/trials-ending",
    { params: { days } },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Lifecycle actions, revenue, at-risk
// ---------------------------------------------------------------------------

export async function suspendSaasCustomer(
  id: string,
  reason?: string,
): Promise<SaasAdminLifecycleResult> {
  const { data } = await api.post<SaasAdminLifecycleResult>(
    `/saas-admin/customers/${id}/suspend`,
    { reason: reason || undefined },
  );
  return data;
}

export async function reactivateSaasCustomer(
  id: string,
): Promise<SaasAdminLifecycleResult> {
  const { data } = await api.post<SaasAdminLifecycleResult>(
    `/saas-admin/customers/${id}/reactivate`,
  );
  return data;
}

export async function changeSaasCustomerPlan(
  id: string,
  planCode: string,
): Promise<SaasAdminLifecycleResult> {
  const { data } = await api.post<SaasAdminLifecycleResult>(
    `/saas-admin/customers/${id}/change-plan`,
    { planCode },
  );
  return data;
}

export async function extendSaasCustomerTrial(
  id: string,
  days: number,
): Promise<SaasAdminLifecycleResult> {
  const { data } = await api.post<SaasAdminLifecycleResult>(
    `/saas-admin/customers/${id}/extend-trial`,
    { days },
  );
  return data;
}

export async function fetchSaasRevenue(): Promise<SaasAdminRevenueResult> {
  const { data } = await api.get<SaasAdminRevenueResult>("/saas-admin/revenue");
  return data;
}

export async function fetchSaasAtRisk(
  inactiveDays = 14,
): Promise<SaasAdminAtRiskRow[]> {
  const { data } = await api.get<SaasAdminAtRiskRow[]>(
    "/saas-admin/at-risk",
    { params: { inactiveDays } },
  );
  return data;
}

export async function fetchSaasCustomerPayments(
  id: string,
  page: number,
  pageSize: number,
): Promise<SaasAdminCustomerPaymentsResponse> {
  const { data } = await api.get<SaasAdminCustomerPaymentsResponse>(
    `/saas-admin/customers/${id}/payments`,
    { params: { page, pageSize } },
  );
  return data;
}

/**
 * Active catalog from the licensing module. SAAS_ADMIN passes the roles
 * guard for /admin/plans, so no dedicated endpoint is needed.
 */
export async function fetchSaasPlanOptions(): Promise<SaasAdminPlanOption[]> {
  const { data } = await api.get<SaasAdminPlanOption[]>("/admin/plans", {
    params: { isActive: true },
  });
  return data;
}
