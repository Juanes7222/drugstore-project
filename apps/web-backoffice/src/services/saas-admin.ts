import { api } from "./api";
import type {
  SaasAdminCustomerDashboard,
  SaasAdminCustomerRow,
  SaasAdminCustomersResponse,
  SaasAdminFiscalStatusResponse,
  SaasAdminSalesResponse,
  SaasAdminSessionsResponse,
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
