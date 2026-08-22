import { api } from './api';
import type {
  CashShiftsResponse,
  DashboardResponse,
  FiscalStatusResponse,
  InventoryAlertsResponse,
  SalesResponse,
  SessionsResponse,
  SubscriptionsResponse,
  UserListResponse,
  UserSessionSummary,
  WorkstationsResponse,
} from '../types/backoffice';

// ---------------------------------------------------------------------------
// Backoffice overview endpoints
// ---------------------------------------------------------------------------

export async function fetchDashboard(): Promise<DashboardResponse> {
  const { data } = await api.get<DashboardResponse>('/backoffice/dashboard');
  return data;
}

export interface SalesFilters {
  from?: string;
  to?: string;
  state?: string;
  userId?: string;
  workstationId?: string;
}

export async function fetchSales(
  filters: SalesFilters,
  page: number,
  pageSize: number,
): Promise<SalesResponse> {
  const { data } = await api.get<SalesResponse>('/backoffice/sales', {
    params: {
      ...filters,
      page,
      pageSize,
    },
  });
  return data;
}

export interface CashShiftFilters {
  from?: string;
  to?: string;
  state?: string;
  userId?: string;
  workstationId?: string;
}

export async function fetchCashShifts(
  filters: CashShiftFilters,
  page: number,
  pageSize: number,
): Promise<CashShiftsResponse> {
  const { data } = await api.get<CashShiftsResponse>('/backoffice/cash-shifts', {
    params: {
      ...filters,
      page,
      pageSize,
    },
  });
  return data;
}

export async function fetchInventoryAlerts(): Promise<InventoryAlertsResponse> {
  const { data } = await api.get<InventoryAlertsResponse>(
    '/backoffice/inventory-alerts',
  );
  return data;
}

export async function fetchFiscalStatus(
  from?: string,
): Promise<FiscalStatusResponse> {
  const { data } = await api.get<FiscalStatusResponse>(
    '/backoffice/fiscal-status',
    { params: from ? { from } : undefined },
  );
  return data;
}

export async function fetchSessions(
  page: number,
  pageSize: number,
): Promise<SessionsResponse> {
  const { data } = await api.get<SessionsResponse>('/backoffice/sessions', {
    params: { page, pageSize },
  });
  return data;
}

export async function fetchWorkstations(): Promise<WorkstationsResponse> {
  const { data } = await api.get<WorkstationsResponse>(
    '/backoffice/workstations',
  );
  return data;
}

export async function fetchSubscriptions(
  page: number,
  pageSize: number,
): Promise<SubscriptionsResponse> {
  const { data } = await api.get<SubscriptionsResponse>(
    '/backoffice/subscriptions',
    { params: { page, pageSize } },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Users (auth module) — list, lifecycle actions, sessions
// ---------------------------------------------------------------------------

export interface UserListFilters {
  status?: string;
  role?: string;
}

export async function fetchUsers(
  filters: UserListFilters,
  page: number,
  pageSize: number,
): Promise<UserListResponse> {
  const { data } = await api.get<UserListResponse>('/users', {
    params: {
      ...filters,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    },
  });
  return data;
}

export async function fetchUserSessions(
  userId: string,
): Promise<UserSessionSummary[]> {
  const { data } = await api.get<UserSessionSummary[]>(
    `/users/${userId}/sessions`,
  );
  return data;
}

export async function approveUser(userId: string): Promise<void> {
  await api.post(`/users/${userId}/approve`);
}

export async function disableUser(userId: string): Promise<void> {
  await api.post(`/users/${userId}/disable`);
}

export async function enableUser(userId: string): Promise<void> {
  await api.post(`/users/${userId}/enable`);
}

export async function unlockUser(userId: string): Promise<void> {
  await api.post(`/users/${userId}/unlock`);
}

export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  await api.post(`/users/${userId}/sessions/${sessionId}/revoke`);
}