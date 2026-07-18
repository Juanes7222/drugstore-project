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

interface NavItem {
  screen: PosScreen;
  labelKey: string;
  roles: RoleType[];
  icon: FC<{ className?: string }>;
}

const HomeIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const SalesIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </svg>
);

const ReturnsIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <polyline points="8 12 12 16 16 12" />
    <line x1="12" y1="8" x2="12" y2="16" />
  </svg>
);

const InventoryIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const getHealthIcon = (): FC<{ className?: string }> => {
  const HealthIcon: FC<{ className?: string }> = ({ className }) => (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
  return HealthIcon;
};

const ClientsIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const CashShiftIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);

const AdminIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
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
    icon: HomeIcon,
  },
  {
    screen: "sales",
    labelKey: "navigation.sales",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: SalesIcon,
  },
  {
    screen: "returns",
    labelKey: "navigation.returns",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: ReturnsIcon,
  },
  {
    screen: "inventory-adjustments",
    labelKey: "navigation.inventory_adjustments",
    roles: [RoleType.MANAGER, RoleType.OWNER],
    icon: InventoryIcon,
  },
  {
    screen: "cash-shift",
    labelKey: "navigation.cash_shift",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER],
    icon: CashShiftIcon,
  },
  {
    screen: "inventory-lots",
    labelKey: "navigation.inventory_lots",
    roles: [RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: InventoryIcon,
  },
  {
    screen: "products",
    labelKey: "navigation.products",
    roles: [RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: InventoryIcon,
  },
  {
    screen: "clients",
    labelKey: "navigation.clients",
    roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: ClientsIcon,
  },
  {
    screen: "user-management",
    labelKey: "navigation.user_management",
    roles: [RoleType.MANAGER, RoleType.OWNER],
    icon: AdminIcon,
  },
  {
    screen: "license-status",
    labelKey: "navigation.license_status",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: AdminIcon,
  },
  {
    screen: "print-queue",
    labelKey: "navigation.print_queue",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: AdminIcon,
  },
  {
    screen: "printers",
    labelKey: "navigation.printers",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: AdminIcon,
  },
  {
    screen: "fiscal",
    labelKey: "navigation.fiscal",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: AdminIcon,
  },
  {
    screen: "audit-log",
    labelKey: "navigation.audit_log",
    roles: [RoleType.MANAGER, RoleType.OWNER],
    icon: getHealthIcon(),
  },
  {
    screen: "admin-menu",
    labelKey: "navigation.admin_menu",
    roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: AdminIcon,
  },
  {
    screen: "sync-health",
    labelKey: "navigation.sync_health",
    roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: getHealthIcon(),
  },
  {
    screen: "recovery",
    labelKey: "navigation.recovery",
    roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
    icon: getHealthIcon(),
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
          const isActive = activeScreen === item.screen;
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
