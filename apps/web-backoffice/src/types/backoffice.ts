/**
 * Frontend types mirroring the backoffice API contract.
 * Monetary values arrive as decimal strings ("1234.56") and are formatted
 * as COP currency at render time.
 */

import type { User } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserRef {
  displayName: string | null;
  fullName: string;
}

export interface WorkstationRef {
  name: string;
  code: string;
}

// ---------------------------------------------------------------------------
// GET /backoffice/dashboard
// ---------------------------------------------------------------------------

export interface SalesTrendDay {
  /** Local calendar day, YYYY-MM-DD */
  date: string;
  confirmedCount: number;
  /** Decimal string; monetary values arrive as decimal strings */
  confirmedAmount: string;
}

export type DashboardPeriod = "today" | "7d" | "30d";

export interface DashboardResponse {
  period: { from: string; to: string };
  salesTrend: { days: SalesTrendDay[] };
  sales: {
    confirmedCount: number;
    confirmedTotal: string;
    averageTicket: string;
    annulledCount: number;
    annulledTotal: string;
    /** Confirmed totals for the immediately preceding equal-length window. */
    previousTotal: string;
    previousCount: number;
    previousAverageTicket: string | null;
  };
  cashShifts: {
    openCount: number;
    differenceCount30d: number;
    differenceAmount30d: string;
  };
  inventory: {
    pendingAdjustments: number;
    expiringLots: number;
    expiredLots: number;
  };
  fiscal: {
    validated: number;
    pending: number;
    rejected: number;
    errors: number;
    contingency: number;
  };
  sync: { permanentFailures: number };
  users: { pendingApproval: number; activeSessions: number };
}

// ---------------------------------------------------------------------------
// GET /backoffice/audit-logs
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  action: string;
  module: string;
  entityId: string;
  summary: string | null;
  ipAddress: string | null;
  createdAt: string;
  user: { fullName: string; displayName: string | null };
}

export type AuditLogsResponse = Paginated<AuditLogRow>;

// ---------------------------------------------------------------------------
// GET /backoffice/sales
// ---------------------------------------------------------------------------

export interface SaleRow {
  id: string;
  localNumber: number;
  internalNumber: string | null;
  operationalState: string;
  confirmedAt: string | null;
  annulledAt: string | null;
  subtotal: string;
  totalDiscount: string;
  totalTax: string;
  totalAmount: string;
  annulmentReason: string | null;
  clientNameSnapshot: string | null;
  userId: string;
  workstationId: string;
  user: UserRef;
  workstation: WorkstationRef;
}

export interface SalesResponse extends Paginated<SaleRow> {
  summary: {
    count: number;
    totalAmount: string;
    totalTax: string;
    totalDiscount: string;
  };
}

export interface SaleDetailItem {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineDiscount: string;
  lineTax: string;
  lineTotal: string;
}

export interface SaleDetail {
  id: string;
  localNumber: number;
  internalNumber: string | null;
  operationalState: string;
  confirmedAt: string | null;
  annulledAt: string | null;
  annulmentReason: string | null;
  clientNameSnapshot: string | null;
  subtotal: string;
  totalDiscount: string;
  totalTax: string;
  totalAmount: string;
  user: { fullName: string; displayName: string | null };
  workstation: { name: string; code: string };
  items: SaleDetailItem[];
}

// ---------------------------------------------------------------------------
// GET /backoffice/cash-shifts
// ---------------------------------------------------------------------------

export interface CashShiftRow {
  id: string;
  workstationId: string;
  userId: string;
  state: string;
  openedAt: string;
  closedAt: string | null;
  openingBalance: string;
  expectedClosingAmount: string | null;
  actualClosingAmount: string | null;
  closingDifference: string | null;
  closingNotes: string | null;
  forcedClose: boolean;
  hasExtendedAlert: boolean;
  user: UserRef;
  workstation: WorkstationRef;
}

export interface CashShiftsResponse extends Paginated<CashShiftRow> {
  summary: { differenceCount: number; differenceAmount: string };
}

// ---------------------------------------------------------------------------
// GET /backoffice/inventory-alerts
// ---------------------------------------------------------------------------

export interface PendingAdjustment {
  id: string;
  sequentialNumber: number;
  reason: string;
  notes: string | null;
  createdAt: string;
  submittedForApprovalAt: string;
  createdByUserId: string;
  createdByUser: UserRef;
}

export interface LotAlert {
  id: string;
  batchNumber: string;
  expirationDate: string;
  currentStock: number;
  productId: string;
  product: { commercialName: string };
}

export interface LowStockItem {
  productId: string;
  commercialName: string;
  minimumStock: number;
  currentStock: number;
}

export interface InventoryAlertsResponse {
  pendingAdjustments: PendingAdjustment[];
  expiringLots: LotAlert[];
  expiredLots: LotAlert[];
  lowStock: LowStockItem[];
}

// ---------------------------------------------------------------------------
// GET /backoffice/fiscal-status
// ---------------------------------------------------------------------------

export interface FiscalCountByState {
  fiscalState: string;
  count: number;
}

export interface RecentRejectedDocument {
  id: string;
  documentType: string;
  fullNumber: string;
  issueDate: string;
  fiscalState: string;
  ptResponseCode: string | null;
  ptResponseMessage: string | null;
  retryCount: number;
  totalAmount: string;
  saleId: string | null;
}

export interface FiscalStatusResponse {
  countsByState: FiscalCountByState[];
  recentRejected: RecentRejectedDocument[];
}

// ---------------------------------------------------------------------------
// GET /backoffice/sessions
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  userId: string;
  workstationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  geoCountry: string | null;
  geoCity: string | null;
  deviceInfo: string | null;
  issuedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  user: {
    displayName: string | null;
    fullName: string;
    email: string | null;
    role: string;
  };
  workstation: WorkstationRef;
}

export type SessionsResponse = Paginated<SessionRow>;

// ---------------------------------------------------------------------------
// GET /backoffice/workstations
// ---------------------------------------------------------------------------

export interface WorkstationRow {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  registeredAt: string;
  lastSeenAt: string | null;
  activeSessions: number;
  salesToday: number;
}

export interface WorkstationsResponse {
  workstations: WorkstationRow[];
  activeSessionCount: number;
}

// ---------------------------------------------------------------------------
// GET /users (auth module) and related actions
// ---------------------------------------------------------------------------

export interface UserListItem {
  id: string;
  displayName: string | null;
  fullName: string;
  email: string | null;
  username: string | null;
  role: string;
  status: string;
  isActive: boolean;
  avatarUrl: string | null;
  avatarColor: string | null;
  authMethod: string;
  totpEnabled: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  createdById: string | null;
  deletedAt: string | null;
}

export interface UserListResponse {
  users: UserListItem[];
  total: number;
}

export interface UserSessionSummary {
  id: string;
  workstationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: string | null;
  issuedAt: string;
  lastActivityAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthUser = User;

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: AuthUser;
  sessionId?: string;
  requiresTwoFactor?: boolean;
  challengeToken?: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}
