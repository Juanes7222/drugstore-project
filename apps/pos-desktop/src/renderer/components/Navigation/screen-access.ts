/**
 * Single source of truth for which roles may open each POS screen.
 *
 * Consumed by NavigationSidebar (item visibility) and the route guard in
 * App.tsx (mount prevention), so a screen can never be visible but
 * unreachable, nor reachable while hidden.
 *
 * This is a UX guard only — the server stays the real security boundary;
 * gating here prevents mounting pages whose mount-time requests would fail
 * with authorization errors.
 */
import { RoleType } from "@pharmacy/shared-types";
import type { PosScreen } from "@/store/slices/ui-types";
import { hasMinRole, type LocalSession } from "../../../domain/auth";

// Role groups. Access follows the minimum hierarchy LEVEL present in each
// list (hasMinRole), not exact membership: listing CASHIER admits every
// level-0 role (INVENTORY_ASSISTANT too) and everything above it, matching
// the semantics the navigation rail always had. Legacy ADMIN is listed
// wherever OWNER appears — the local hierarchy table in
// local-session.store assigns both the same level.
const ALL_ROLES: RoleType[] = [
  RoleType.CASHIER,
  RoleType.INVENTORY_ASSISTANT,
  RoleType.ACCOUNTANT,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

/** Checkout flow: selling, payment, receipt, prescriptions, returns, clients. */
const SALES_ROLES: RoleType[] = [
  RoleType.CASHIER,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

/** Catalog, lots, inventory adjustments and the purchase pipeline. */
const INVENTORY_ROLES: RoleType[] = [
  RoleType.INVENTORY_ASSISTANT,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

/** Store-level administration: users, sessions, licensing, printing, fiscal, sync. */
const MANAGEMENT_ROLES: RoleType[] = [
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

/** Tenant-wide configuration and disaster recovery. */
const OWNER_ROLES: RoleType[] = [
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

/**
 * Allowed roles per screen. The Record is total over PosScreen, so the
 * compiler fails when a new screen is added without deciding its access.
 */
export const SCREEN_ALLOWED_ROLES: Record<PosScreen, RoleType[]> = {
  // Pre-auth and onboarding gates — any visitor may land here.
  login: ALL_ROLES,
  "forgot-password": ALL_ROLES,
  "reset-password": ALL_ROLES,
  "company-setup": ALL_ROLES,
  "certificate-setup": ALL_ROLES,
  "licensing-plans": ALL_ROLES,

  // Operation
  home: ALL_ROLES,
  about: ALL_ROLES,
  reports: ALL_ROLES,
  "2fa-setup": ALL_ROLES,
  sales: SALES_ROLES,
  payment: SALES_ROLES,
  receipt: SALES_ROLES,
  prescriptions: SALES_ROLES,
  returns: SALES_ROLES,
  clients: SALES_ROLES,
  "cash-shift": [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],

  // Inventory & purchasing
  "productos-main": INVENTORY_ROLES,
  products: INVENTORY_ROLES,
  "inventory-lots": INVENTORY_ROLES,
  "inventory-adjustments": INVENTORY_ROLES,
  "purchases-main": INVENTORY_ROLES,
  suppliers: INVENTORY_ROLES,
  "purchase-orders": INVENTORY_ROLES,
  "purchase-receptions": INVENTORY_ROLES,
  "supplier-returns": INVENTORY_ROLES,

  // Management
  "sales-history": MANAGEMENT_ROLES,
  "user-management": [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
  "audit-log": [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
  "offline-sessions": [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
  "license-status": MANAGEMENT_ROLES,
  printing: MANAGEMENT_ROLES,
  printers: MANAGEMENT_ROLES,
  "print-queue": MANAGEMENT_ROLES,
  "setup-wizard": MANAGEMENT_ROLES,
  fiscal: MANAGEMENT_ROLES,

  // System
  "admin-menu": OWNER_ROLES,
  "sync-health": MANAGEMENT_ROLES,
  "local-network": MANAGEMENT_ROLES,
  recovery: OWNER_ROLES,
};

/**
 * Whether the session's role may open the given screen. Screens missing
 * from the map (or mapped to an empty list) are denied by default.
 */
export function canAccessScreen(
  session: LocalSession | null,
  screen: PosScreen,
): boolean {
  if (!session) return false;

  const allowedRoles = SCREEN_ALLOWED_ROLES[screen];
  if (!allowedRoles || allowedRoles.length === 0) return false;

  return allowedRoles.some((role) => hasMinRole(session, role));
}
