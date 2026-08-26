/**
 * Single source of truth for which roles may open each POS screen.
 *
 * Consumed by NavigationSidebar (item visibility) and the route guard in
 * App.tsx (mount prevention), so a screen can never be visible but
 * unreachable, nor reachable while hidden.
 *
 * Access is EXACT membership on purpose. The earlier version collapsed each
 * list to its minimum hierarchy level via hasMinRole, which silently
 * admitted same-level roles the lists never named — an ACCOUNTANT opened
 * every manager screen and then hit 403s on nearly every request behind
 * it, because the server enforces granular per-endpoint roles that do not
 * treat ACCOUNTANT as MANAGER-equivalent. The server stays the real
 * security boundary; this map exists to keep users inside screens their
 * role can actually use.
 */
import { RoleType } from "@pharmacy/shared-types";
import type { PosScreen } from "@/store/slices/ui-types";
import type { LocalSession } from "../../../domain/auth";

// Legacy ADMIN is listed wherever OWNER appears: the local hierarchy table
// in local-session.store assigns both the same level.
const ALL_ROLES: RoleType[] = [
  RoleType.CASHIER,
  RoleType.INVENTORY_ASSISTANT,
  RoleType.ACCOUNTANT,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

/** Selling floor: checkout, prescriptions, returns, clients, cash shifts. */
const FLOOR_ROLES: RoleType[] = [
  RoleType.CASHIER,
  RoleType.INVENTORY_ASSISTANT,
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

/** Store-level administration: users, sessions, licensing, printing, fiscal, sync.
 *  ACCOUNTANT is deliberately absent — the server rejects its requests on
 *  these screens, so showing them only produces authorization errors. */
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

/** Sales history: cashiers may view (read-only), managers and above may modify. */
const SALES_HISTORY_ROLES: RoleType[] = [
  RoleType.CASHIER,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

/**
 * Allowed roles per screen. The Record is total over PosScreen, so the
 * compiler fails when a new screen is added without deciding its access.
 *
 * An ACCOUNTANT gets home, reports and about only — everything else it
 * needs flows through the reports module.
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
  sales: FLOOR_ROLES,
  payment: FLOOR_ROLES,
  receipt: FLOOR_ROLES,
  prescriptions: FLOOR_ROLES,
  returns: FLOOR_ROLES,
  clients: FLOOR_ROLES,
  "cash-shift": FLOOR_ROLES,

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
  "sales-history": SALES_HISTORY_ROLES,
  "user-management": [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
  "audit-log": [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
  "offline-sessions": [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
  "license-status": MANAGEMENT_ROLES,
  printing: MANAGEMENT_ROLES,
  printers: MANAGEMENT_ROLES,
  "print-queue": MANAGEMENT_ROLES,
  "setup-wizard": MANAGEMENT_ROLES,
  // Fiscal credential/config endpoints answer 403 to MANAGER server-side
  // (certs and issuer config are ADMIN+OWNER only), so the fiscal screen
  // follows that stricter set instead of MANAGEMENT_ROLES.
  fiscal: OWNER_ROLES,

  // System
  "admin-menu": OWNER_ROLES,
  "sync-health": MANAGEMENT_ROLES,
  "local-network": MANAGEMENT_ROLES,
  recovery: OWNER_ROLES,
};

/**
 * Whether the session's role may open the given screen. Exact membership —
 * no hierarchy collapse; screens missing from the map (or mapped to an
 * empty list) are denied by default, as are unknown role strings.
 */
export function canAccessScreen(
  session: LocalSession | null,
  screen: PosScreen,
): boolean {
  if (!session) return false;

  const allowedRoles = SCREEN_ALLOWED_ROLES[screen];
  if (!allowedRoles || allowedRoles.length === 0) return false;

  return allowedRoles.includes(session.role as RoleType);
}
