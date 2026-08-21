/**
 * NavigationSidebar — slim left-hand navigation for the POS terminal.
 *
 * Collapsed (48 px) by default, expands to 200 px on hover or focus-within.
 * Renders role-gated navigation items grouped by category; the list scrolls
 * internally when it does not fit the window height.
 *
 * Items are grouped and shown/hidden based on the current session role:
 *   - Sales (CASHIER or above)
 *   - Returns (CASHIER or above)
 *   - Inventory Adjustments (INVENTORY_ASSISTANT or ADMIN)
 *   - Admin / Sync (ADMIN only)
 *
 * The pin button at the bottom keeps the rail expanded persistently
 * (stored in the user-preferences store, so it survives restarts).
 */
import { type FC, Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectActiveScreen, setActiveScreen } from "@/store/slices/ui-slice";
import type { PosScreen } from "@/store/slices/ui-types";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth/local-session.store";
import { useUserPreferencesStore } from "../../../stores/user-preferences.store";
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
  PinIcon,
  PrinterIcon as PrinterIconModule,
  ReceiptIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SettingsIcon,
  TagIcon,
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
  /** Group under which the item is rendered in the rail. */
  category: NavCategory;
}

// ── Nav categories ────────────────────────────────────────────────────
type NavCategory = "operation" | "inventory" | "management" | "system";

const CATEGORY_ORDER: NavCategory[] = [
  "operation",
  "inventory",
  "management",
  "system",
];

const CATEGORY_LABEL_KEY: Record<NavCategory, string> = {
  operation: "navigation.category_operation",
  inventory: "navigation.category_inventory",
  management: "navigation.category_management",
  system: "navigation.category_system",
};

// Rail widths in px — must match the .pos-sidebar base width in global.css.
const SIDEBAR_WIDTH_COLLAPSED = 48;
const SIDEBAR_WIDTH_EXPANDED = 200;

// ── Nav icon adapters ────────────────────────────────────────────────
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

const NavPlansIcon: FC<{ className?: string }> = ({ className }) => (
  <TagIcon className={className} size={20} />
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
    category: "operation",
  },
  {
    screen: "sales",
    labelKey: "navigation.sales",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavSalesIcon,
    category: "operation",
  },
  {
    screen: "sales-history",
    labelKey: "navigation.sales_history",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavHistoryIcon,
    category: "operation",
  },
  {
    screen: "returns",
    labelKey: "navigation.returns",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavReturnsIcon,
    category: "operation",
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
    category: "inventory",
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
    category: "inventory",
  },
  {
    screen: "cash-shift",
    labelKey: "navigation.cash_shift",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER],
    icon: NavCashShiftIcon,
    category: "operation",
  },
  {
    screen: "clients",
    labelKey: "navigation.clients",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavClientsIcon,
    category: "operation",
  },
  {
    screen: "user-management",
    labelKey: "navigation.user_management",
    roles: [RoleType.MANAGER, RoleType.OWNER],
    icon: NavUsersIcon,
    category: "management",
  },
  {
    screen: "license-status",
    labelKey: "navigation.license_status",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavLicenseIcon,
    category: "management",
  },
  {
    screen: "licensing-plans",
    labelKey: "licensing.plans.sidebar",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavPlansIcon,
    category: "management",
  },
  {
    screen: "printing",
    labelKey: "navigation.printing",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavPrinterIcon,
    relatedScreens: ["printers", "print-queue", "setup-wizard"],
    category: "management",
  },
  {
    screen: "fiscal",
    labelKey: "navigation.fiscal",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavFiscalIcon,
    category: "management",
  },
  {
    screen: "audit-log",
    labelKey: "navigation.audit_log",
    roles: [RoleType.MANAGER, RoleType.OWNER],
    icon: NavAuditIcon,
    category: "management",
  },
  {
    screen: "admin-menu",
    labelKey: "navigation.admin_menu",
    roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavAdminIcon,
    category: "system",
  },
  {
    screen: "sync-health",
    labelKey: "navigation.sync_health",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavSyncHealthIcon,
    category: "system",
  },
  {
    screen: "local-network",
    labelKey: "navigation.local_network",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavLocalNetworkIcon,
    category: "system",
  },
  {
    screen: "recovery",
    labelKey: "navigation.recovery",
    roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: NavRecoveryIcon,
    category: "system",
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
    category: "management",
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
  const pinned = useUserPreferencesStore((s) => s.sidebarPinned);
  const setSidebarPinned = useUserPreferencesStore((s) => s.setSidebarPinned);
  const isExpanded = alwaysExpanded || pinned || isHovered;
  const shouldReduceMotion = useReducedMotion();
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

  const groupedCategories = CATEGORY_ORDER.map((category) => ({
    category,
    items: visibleItems.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <motion.nav
      className="pos-sidebar"
      data-expanded={isExpanded}
      role="navigation"
      aria-label={t("navigation.label")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      animate={{
        width: isExpanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED,
      }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 380, damping: 34, mass: 0.8 }
      }
    >
      <ul className="pos-sidebar__list" role="menubar" aria-orientation="vertical">
        {groupedCategories.map(({ category, items }) => (
          <Fragment key={category}>
            <li role="none">
              <span
                className="pos-sidebar__group-label"
                data-visible={isExpanded}
                aria-hidden="true"
              >
                {t(CATEGORY_LABEL_KEY[category])}
              </span>
            </li>
            {items.map((item) => {
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
                    {isActive && (
                      <motion.span
                        layoutId="pos-sidebar-active-indicator"
                        className="pos-sidebar__active-indicator"
                        transition={
                          shouldReduceMotion
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 480, damping: 40 }
                        }
                        aria-hidden="true"
                      />
                    )}
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
          </Fragment>
        ))}
      </ul>

      {/* Pin toggle — keep the rail expanded across navigation */}
      {!alwaysExpanded && (
        <div className="pos-sidebar__footer">
          <button
            type="button"
            className="pos-sidebar__pin"
            data-active={pinned}
            onClick={() => setSidebarPinned(!pinned)}
            aria-pressed={pinned}
            aria-label={t(
              pinned ? "navigation.collapse_sidebar" : "navigation.expand_sidebar",
            )}
            title={t(
              pinned ? "navigation.collapse_sidebar" : "navigation.expand_sidebar",
            )}
          >
            <PinIcon className="pos-sidebar__pin-icon" size={16} />
            <span
              className="pos-sidebar__pin-label"
              data-visible={isExpanded}
            >
              {t(
                pinned ? "navigation.collapse_sidebar" : "navigation.expand_sidebar",
              )}
            </span>
          </button>
        </div>
      )}
    </motion.nav>
  );
};
