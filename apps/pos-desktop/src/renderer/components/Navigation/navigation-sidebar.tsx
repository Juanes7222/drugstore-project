/**
 * NavigationSidebar — slim left-hand navigation for the POS terminal.
 *
 * Collapsed (48 px) by default, expands to 200 px on hover or focus-within.
 * Renders role-gated navigation items that dispatch screen-switching actions.
 *
 * Items are grouped and shown/hidden based on the current session role:
 *   - Sales (CASHIER or above)
 *   - Returns (CASHIER or above)
 *   - Inventory Adjustments (INVENTORY_ASSISTANT or ADMIN)
 *   - Admin / Sync (ADMIN only)
 */
import { type FC, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectActiveScreen, setActiveScreen } from "@/store/slices/ui-slice";
import type { PosScreen } from "@/store/slices/ui-types";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth/local-session.store";
import { RoleType } from "@pharmacy/shared-types";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import type { PrismaClient } from "@pharmacy/database/local";
import { createSyncMetricsService } from "../../../domain/sync/sync-metrics.service";
import {
  ArchiveIcon,
  BarChartIcon,
  ClockIcon,
  CloudIcon,
  CreditCardIcon,
  DollarSignIcon,
  HomeIcon as HomeIconModule,
  MonitorIcon,
  PackageIcon,
  PrinterIcon as PrinterIconModule,
  ReceiptIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon as UsersIconModule,
  WifiIcon,
} from "@/components/ui/icons";

interface NavItem {
  screen: PosScreen;
  labelKey: string;
  roles: RoleType[];
  icon: FC<{ className?: string }>;
  /** Additional screens that should highlight this nav item as active. */
  relatedScreens?: PosScreen[];
}

// ── Nav icon adapters ────────────────────────────────────────────────────
// Wrap the reusable icon components in FC<{ className?: string }> to match
// the NavItem interface, passing size=20 as the sidebar standard.

const NavHomeIcon: FC<{ className?: string }> = ({ className }) => (
  <HomeIconModule className={className} size={20} />
);

const NavSalesIcon: FC<{ className?: string }> = ({ className }) => (
  <MonitorIcon className={className} size={20} />
);

const NavReturnsIcon: FC<{ className?: string }> = ({ className }) => (
  <RefreshCwIcon className={className} size={20} />
);

const NavInventoryIcon: FC<{ className?: string }> = ({ className }) => (
  <PackageIcon className={className} size={20} />
);

const NavClientsIcon: FC<{ className?: string }> = ({ className }) => (
  <UsersIconModule className={className} size={20} />
);

const NavPurchasesIcon: FC<{ className?: string }> = ({ className }) => (
  <ArchiveIcon className={className} size={20} />
);

const NavCashShiftIcon: FC<{ className?: string }> = ({ className }) => (
  <DollarSignIcon className={className} size={20} />
);

const NavHistoryIcon: FC<{ className?: string }> = ({ className }) => (
  <ClockIcon className={className} size={20} />
);

const NavPrinterIcon: FC<{ className?: string }> = ({ className }) => (
  <PrinterIconModule className={className} size={20} />
);

const NavReportsIcon: FC<{ className?: string }> = ({ className }) => (
  <BarChartIcon className={className} size={20} />
);

const NavAdminIcon: FC<{ className?: string }> = ({ className }) => (
  <SettingsIcon className={className} size={20} />
);

const NavLicenseIcon: FC<{ className?: string }> = ({ className }) => (
  <CreditCardIcon className={className} size={20} />
);

const NavUsersIcon: FC<{ className?: string }> = ({ className }) => (
  <UserIcon className={className} size={20} />
);

const NavAuditIcon: FC<{ className?: string }> = ({ className }) => (
  <ScrollTextIcon className={className} size={20} />
);

const NavSyncHealthIcon: FC<{ className?: string }> = ({ className }) => (
  <CloudIcon className={className} size={20} />
);

const NavLocalNetworkIcon: FC<{ className?: string }> = ({ className }) => (
  <WifiIcon className={className} size={20} />
);

const NavRecoveryIcon: FC<{ className?: string }> = ({ className }) => (
  <RotateCcwIcon className={className} size={20} />
);

const NavFiscalIcon: FC<{ className?: string }> = ({ className }) => (
  <ReceiptIcon className={className} size={20} />
);

/**
 * Check if the current session's role is among the allowed roles for a nav item.
 */
const hasAccess = (allowedRoles: RoleType[]): boolean => {
  const session = useLocalSessionStore.getState().session;
  if (!session) {
    return false;
  }
  return allowedRoles.some((role) => hasMinRole(session, role));
};

const NAV_ITEMS: NavItem[] = [
  {
    screen: "home",
    labelKey: "navigation.home",
    roles: [RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.ACCOUNTANT, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavHomeIcon,
  },
  {
    screen: "sales",
    labelKey: "navigation.sales",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavSalesIcon,
  },
  {
    screen: "sales-history",
    labelKey: "navigation.sales_history",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavHistoryIcon,
  },
  {
    screen: "returns",
    labelKey: "navigation.returns",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavReturnsIcon,
  },
  {
    screen: "productos-main",
    labelKey: "navigation.products_main",
    roles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    icon: NavInventoryIcon,
    relatedScreens: [
      "productos-main",
      "products",
      "inventory-lots",
      "inventory-adjustments",
    ],
  },
  {
    screen: "purchases-main",
    labelKey: "navigation.suppliers",
    roles: [
      RoleType.INVENTORY_ASSISTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
    ],
    icon: NavPurchasesIcon,
    relatedScreens: [
      "purchases-main",
      "suppliers",
      "purchase-orders",
      "purchase-receptions",
      "supplier-returns",
    ],
  },
  {
    screen: "cash-shift",
    labelKey: "navigation.cash_shift",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER],
    icon: NavCashShiftIcon,
  },
  {
    screen: "clients",
    labelKey: "navigation.clients",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavClientsIcon,
  },
  {
    screen: "user-management",
    labelKey: "navigation.user_management",
    roles: [RoleType.MANAGER, RoleType.OWNER],
    icon: NavUsersIcon,
  },
  {
    screen: "license-status",
    labelKey: "navigation.license_status",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavLicenseIcon,
  },
  {
    screen: "printing",
    labelKey: "navigation.printing",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavPrinterIcon,
    relatedScreens: ["printers", "print-queue", "setup-wizard"],
  },
  {
    screen: "fiscal",
    labelKey: "navigation.fiscal",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavFiscalIcon,
  },
  {
    screen: "audit-log",
    labelKey: "navigation.audit_log",
    roles: [RoleType.MANAGER, RoleType.OWNER],
    icon: NavAuditIcon,
  },
  {
    screen: "admin-menu",
    labelKey: "navigation.admin_menu",
    roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavAdminIcon,
  },
  {
    screen: "sync-health",
    labelKey: "navigation.sync_health",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavSyncHealthIcon,
  },
  {
    screen: "local-network",
    labelKey: "navigation.local_network",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavLocalNetworkIcon,
  },
  {
    screen: "recovery",
    labelKey: "navigation.recovery",
    roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavRecoveryIcon,
  },
  {
    screen: "reports",
    labelKey: "navigation.reports",
    roles: [
      RoleType.CASHIER,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.SAAS_ADMIN,
      RoleType.ACCOUNTANT,
      RoleType.INVENTORY_ASSISTANT,
    ],
    icon: NavReportsIcon,
  },
];

interface NavigationSidebarProps {
  /** Optional override to always expand (e.g. for accessibility). */
  alwaysExpanded?: boolean;
}

export const NavigationSidebar: FC<NavigationSidebarProps> = ({
  alwaysExpanded = false,
}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const activeScreen = useAppSelector(selectActiveScreen);
  const [isHovered, setIsHovered] = useState(false);
  const isExpanded = alwaysExpanded || isHovered;
  const [badgeCount, setBadgeCount] = useState(0);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const pollBadge = async () => {
      try {
        const { prisma } = await getLocalDatabase();
        const counts = await createSyncMetricsService(prisma as PrismaClient).getQueueCounts();
        setBadgeCount(counts.permanentFailure);
      } catch {
        // Badge is advisory; do not surface errors.
      }
    };

    void pollBadge();
    intervalId = setInterval(pollBadge, 60_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pollBadge();
        intervalId = setInterval(pollBadge, 60_000);
      } else if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const handleNav = useCallback(
    (screen: PosScreen) => {
      dispatch(setActiveScreen(screen));
    },
    [dispatch],
  );

  const visibleItems = NAV_ITEMS.filter((item) => hasAccess(item.roles));

  return (
    <nav
      className="pos-sidebar"
      data-expanded={isExpanded}
      role="navigation"
      aria-label={t("navigation.label")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <ul className="pos-sidebar__list" role="menubar" aria-orientation="vertical">
        {visibleItems.map((item) => {
          const relatedScreens = item.relatedScreens ?? [];
          const isActive =
            relatedScreens.includes(activeScreen) || activeScreen === item.screen;
          const Icon = item.icon;

          return (
            <li key={item.screen} role="none">
              <button
                type="button"
                role="menuitem"
                aria-current={isActive ? "page" : undefined}
                aria-label={t(item.labelKey)}
                className={`pos-sidebar__item ${isActive ? "pos-sidebar__item--active" : ""}`}
                onClick={() => handleNav(item.screen)}
              >
                <div className="pos-sidebar__item-icon-wrapper">
                  <Icon className="pos-sidebar__item-icon" />
                  {item.screen === "sync-health" && badgeCount > 0 && (
                    <span
                      className="pos-sidebar__badge"
                      aria-label={`${badgeCount > 99 ? "99+" : badgeCount} permanent failures`}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </div>
                <span
                  className="pos-sidebar__item-label"
                  data-visible={isExpanded}
                >
                  {t(item.labelKey)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
