import { RoleType } from "@pharmacy/shared-types";
import {
  DashboardIcon,
  PeopleIcon,
  PointOfSaleIcon,
  PaymentsIcon,
  InventoryIcon,
  ReceiptIcon,
  DevicesIcon,
  DesktopWindowsIcon,
  HistoryIcon,
  AttachMoneyIcon,
  TrendingDownIcon,
  WarningAmberIcon,
  WorkspacePremiumIcon,
  HowToRegIcon,
} from "./icons/app-icons";
import type { AppIconComponent } from "./icons/app-icon-component";

/**
 * Single source of truth for sidebar navigation in both surfaces. The
 * command palette reuses these lists so new routes appear in both places
 * after one edit.
 */
export interface NavItemConfig {
  to: string;
  labelKey: string;
  icon: AppIconComponent;
  /** When present, only these roles may see the item. */
  roles?: RoleType[];
}

/** Tenant backoffice surface (teal theme). */
export const BACKOFFICE_NAV_ITEMS: NavItemConfig[] = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: DashboardIcon },
  { to: "/users", labelKey: "nav.users", icon: PeopleIcon },
  { to: "/sales", labelKey: "nav.sales", icon: PointOfSaleIcon },
  { to: "/cash-shifts", labelKey: "nav.cashShifts", icon: PaymentsIcon },
  { to: "/inventory-alerts", labelKey: "nav.inventoryAlerts", icon: InventoryIcon },
  { to: "/fiscal", labelKey: "nav.fiscal", icon: ReceiptIcon },
  { to: "/sessions", labelKey: "nav.sessions", icon: DevicesIcon },
  { to: "/audit", labelKey: "nav.audit", icon: HistoryIcon, roles: [RoleType.ADMIN] },
  { to: "/workstations", labelKey: "nav.workstations", icon: DesktopWindowsIcon },
];

/** Platform-owner surface (/admin, violet theme). */
export const ADMIN_NAV_ITEMS: NavItemConfig[] = [
  { to: "/admin", labelKey: "saas.navOverview", icon: DashboardIcon },
  { to: "/admin/customers", labelKey: "saas.navCustomers", icon: PeopleIcon },
  { to: "/admin/revenue", labelKey: "saas.navRevenue", icon: AttachMoneyIcon },
  { to: "/admin/at-risk", labelKey: "saas.navAtRisk", icon: TrendingDownIcon },
  { to: "/admin/fraud", labelKey: "saas.navFraud", icon: WarningAmberIcon },
  { to: "/admin/sync", labelKey: "saas.navSync", icon: DevicesIcon },
  { to: "/admin/plans", labelKey: "saas.navPlans", icon: WorkspacePremiumIcon },
  { to: "/admin/admins", labelKey: "saas.navAdmins", icon: HowToRegIcon },
  { to: "/admin/audit", labelKey: "saas.navAudit", icon: HistoryIcon },
];
