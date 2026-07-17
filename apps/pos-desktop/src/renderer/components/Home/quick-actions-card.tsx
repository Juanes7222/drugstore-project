/**
 * QuickActionsCard — grid of shortcut buttons for the Home dashboard.
 *
 * Each action has a lucide icon, a translation key, and a callback. Actions
 * are role-gated and only rendered when the current session's role matches.
 *
 * Renders a 2×2 grid (or 3/4 col depending on count) via Tailwind.
 */
import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ShoppingCart,
  RefreshCw,
  Package,
  Search,
  Users,
  Settings,
  FileText,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import {
  navigateToSales,
  navigateToReturns,
  navigateToInventoryAdjustments,
  navigateToUserManagement,
  navigateToAuditLog,
  navigateToSyncHealth,
  navigateToAdminMenu,
} from "@/store/slices/ui-slice";
import { useLocalSessionStore } from "../../../domain/auth";
import { RoleType } from "@pharmacy/shared-types";

interface QuickAction {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  roles: RoleType[];
  onClick: () => void;
}

interface QuickActionsCardProps {
  /** Optional className for outer wrapper */
  className?: string;
}

export const QuickActionsCard: FC<QuickActionsCardProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);

  const goToSales = useCallback(() => dispatch(navigateToSales()), [dispatch]);
  const goToReturns = useCallback(() => dispatch(navigateToReturns()), [dispatch]);
  const goToInventory = useCallback(
    () => dispatch(navigateToInventoryAdjustments()),
    [dispatch],
  );
  const goToUsers = useCallback(() => dispatch(navigateToUserManagement()), [dispatch]);
  const goToAudit = useCallback(() => dispatch(navigateToAuditLog()), [dispatch]);
  const goToSync = useCallback(() => dispatch(navigateToSyncHealth()), [dispatch]);
  const goToConfig = useCallback(() => dispatch(navigateToAdminMenu()), [dispatch]);

  const ACTIONS: QuickAction[] = [
    {
      id: "new-sale",
      labelKey: "home.new_sale",
      icon: ShoppingCart,
      roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
      onClick: goToSales,
    },
    {
      id: "new-return",
      labelKey: "home.new_return",
      icon: RefreshCw,
      roles: [RoleType.CASHIER, RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
      onClick: goToReturns,
    },
    {
      id: "inventory",
      labelKey: "home.inventory",
      icon: Package,
      roles: [
        RoleType.INVENTORY_ASSISTANT,
        RoleType.MANAGER,
        RoleType.OWNER,
        RoleType.SAAS_ADMIN,
      ],
      onClick: goToInventory,
    },
    {
      id: "search-product",
      labelKey: "home.search_product",
      icon: Search,
      roles: [RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.MANAGER, RoleType.OWNER],
      onClick: goToSales,
    },
    {
      id: "users",
      labelKey: "home.users",
      icon: Users,
      roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
      onClick: goToUsers,
    },
    {
      id: "audit",
      labelKey: "home.audit",
      icon: FileText,
      roles: [RoleType.MANAGER, RoleType.OWNER, RoleType.SAAS_ADMIN],
      onClick: goToAudit,
    },
    {
      id: "sync",
      labelKey: "home.sync_status",
      icon: Activity,
      roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
      onClick: goToSync,
    },
    {
      id: "config",
      labelKey: "home.config",
      icon: Settings,
      roles: [RoleType.OWNER, RoleType.SAAS_ADMIN],
      onClick: goToConfig,
    },
  ];

  // Use exact role membership for quick actions (not hierarchy), because
  // CASHIER (level 0) and INVENTORY_ASSISTANT (level 0) share a hierarchy
  // level but have disjoint tool sets.
  const visibleActions = ACTIONS.filter((a) =>
    a.roles.includes((session?.role as RoleType) ?? ""),
  );

  // Always show at least the "no actions" fallback for roles without any quick action.
  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <h3 className="pos-page-title text-ui font-semibold mb-pos-md">
        {t("home.quick_actions")}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-pos-md">
        {visibleActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              className="pos-panel flex flex-col items-center justify-center gap-pos-sm py-pos-xl px-pos-md cursor-pointer hover:shadow-pos-elevated transition-shadow duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-pharma"
              style={{ minHeight: "100px" }}
              aria-label={t(action.labelKey)}
            >
              <Icon
                className="shrink-0"
                size={28}
                strokeWidth={1.5}
                style={{ color: "var(--color-pharma)" }}
                aria-hidden="true"
              />
              <span className="text-body-sm font-medium text-center leading-tight">
                {t(action.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
