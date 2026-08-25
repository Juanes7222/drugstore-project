/**
 * Frontend types mirroring the /saas-admin API contract (platform-owner
 * surface). Monetary values arrive as decimal strings, same convention as
 * the tenant backoffice API.
 */

import type {
  FiscalStatusResponse,
  Paginated,
  SalesResponse,
  SessionsResponse,
  UserListResponse,
  WorkstationsResponse,
} from "./backoffice";

export interface PlatformCustomersSummary {
  total: number;
  active: number;
  trial: number;
  pastDue: number;
  canceled: number;
  suspended: number;
}

export interface PlatformOverviewResult {
  customers: PlatformCustomersSummary;
  sales30d: { count: number; totalAmount: string };
  activeSessions: number;
  workstationCount: number;
  openFraudAlerts: number;
}

export interface SaasAdminCustomerRow {
  id: string;
  customerName: string;
  customerTaxId: string;
  customerEmail: string | null;
  status: string;
  plan: { code: string; name: string };
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  _count: {
    locations: number;
    workstationActivations: number;
    fraudAlerts: number;
  };
  /** Max session activity across the tenant, else latest confirmed sale. */
  lastActivityAt: string | null;
}

export type SaasAdminCustomersResponse = Paginated<SaasAdminCustomerRow>;

export interface SaasAdminCustomerDashboard {
  salesToday: { count: number; totalAmount: string };
  sales30d: { count: number; totalAmount: string; previousTotal: string };
  cashShifts: { openCount: number; differenceAmount30d: string };
  users: { pendingApproval: number };
  fiscal: { pending: number; rejected: number };
}

// Customer sub-resources reuse the tenant response shapes verbatim.
export type SaasAdminSalesResponse = SalesResponse;
export type SaasAdminSessionsResponse = SessionsResponse;
export type SaasAdminWorkstationsResponse = WorkstationsResponse;
export type SaasAdminFiscalStatusResponse = FiscalStatusResponse;
export type SaasAdminUsersResponse = UserListResponse;

export type SaasAdminTabKey =
  | "overview"
  | "sales"
  | "users"
  | "sessions"
  | "workstations"
  | "fiscal";
