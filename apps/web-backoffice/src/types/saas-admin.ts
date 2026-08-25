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
  /** Zero-filled daily buckets over the same trailing window as sales30d. */
  salesTrend: {
    days: { date: string; count: number; totalAmount: string }[];
  };
  cashShifts: { openCount: number; differenceAmount30d: string };
  users: { pendingApproval: number };
  fiscal: { pending: number; rejected: number };
}

export interface SaasAdminFraudAlertRow {
  id: string;
  subscriptionId: string;
  customerName: string;
  /** Detector that raised the alert (server-side detector class). */
  type: string;
  severity: string;
  suggestedAction: string;
  description: string;
  status: string;
  createdAt: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedByAdminEmail: string | null;
}

export type SaasAdminFraudAlertsResponse = Paginated<SaasAdminFraudAlertRow>;

export interface SaasAdminAccessAuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  subscriptionId: string | null;
  customerName: string | null;
  summary: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export type SaasAdminAccessAuditResponse = Paginated<SaasAdminAccessAuditRow>;

export interface SaasAdminTrialsEndingResult {
  days: number;
  trials: {
    subscriptionId: string;
    customerName: string;
    customerEmail: string | null;
    trialEndsAt: string;
    plan: { code: string; name: string };
  }[];
}

// ---------------------------------------------------------------------------
// Lifecycle actions — every action returns the refreshed customer row so the
// caller can patch one cache entry.
// ---------------------------------------------------------------------------

export type SaasAdminLifecycleResult = SaasAdminCustomerRow;

export interface SaasAdminRevenueResult {
  last30d: { totalAmount: string; count: number };
  /** 12 months incl current, oldest first, zero-filled ('YYYY-MM'). */
  revenueByMonth: { month: string; totalAmount: string; count: number }[];
  planDistribution: {
    planCode: string;
    planName: string;
    activeSubscriptions: number;
  }[];
  /** Null when no ACTIVE subscription carries a price. */
  mrr: string | null;
}

export interface SaasAdminCustomerPaymentRow {
  id: string;
  amount: string;
  currency: string;
  method: string | null;
  externalReference: string | null;
  recordedAt: string;
  createdAt: string;
}

export type SaasAdminCustomerPaymentsResponse =
  Paginated<SaasAdminCustomerPaymentRow>;

export interface SaasAdminAtRiskRow {
  subscriptionId: string;
  customerName: string;
  customerEmail: string | null;
  status: string;
  /** Null = never confirmed a sale; sorts first (stalest). */
  lastSaleAt: string | null;
  workstationActivations: number;
}

/** Minimal projection of the licensing GET /admin/plans row. */
export interface SaasAdminPlanOption {
  id: string;
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Phase 3 — platform admins, sync health, plan management
// ---------------------------------------------------------------------------

export interface SaasAdminPlatformAdminRow {
  userId: string;
  email: string | null;
  username: string | null;
  fullName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SaasAdminSyncHealthRow {
  subscriptionId: string;
  customerName: string;
  pendingOperations: number;
  permanentFailures: number;
  oldestPendingAt: string | null;
  lastSyncAt: string | null;
}

/**
 * Row returned by the licensing /admin/plans endpoints. Fields the saas
 * panel does not edit stay optional so unknown additions never break it.
 */
export interface SaasAdminPlanRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  billingMethod?: "PROVIDER" | "CERTIFICATE" | null;
  pricingModel:
    | "FLAT"
    | "PER_LOCATION"
    | "PER_WORKSTATION"
    | "TIERED";
  basePriceCents: number;
  currency: string;
  billingPeriod: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  maxLocations?: number;
  includedWorkstations?: number;
  extraWorkstationPriceCents?: number | null;
  features?: string[];
  displayOrder?: number;
  isActive: boolean;
  isPublic: boolean;
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
  | "payments"
  | "users"
  | "sessions"
  | "workstations"
  | "fiscal";
