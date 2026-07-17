/**
 * Home — role-aware dashboard shown after login.
 *
 * Renders a welcome header (greeting + role badge), a quick-actions grid,
 * and role-specific stat sections. Uses motion only for the initial
 * staggered entrance — after that no animation sits on the critical path.
 *
 * Composition:
 *   1. Greeting header with role badge + session info
 *   2. QuickActionsCard (role-gated shortcuts)
 *   3. Stats / role-specific panels below
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  ShoppingCart,
  Clock,
  Wifi,
  WifiOff,
  AlertTriangle,
  Users,
  FileText,
} from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { navigateToSales } from "@/store/slices/ui-slice";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth";
import { RoleType } from "@pharmacy/shared-types";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { QuickActionsCard } from "./quick-actions-card";
import { StatsCard } from "./stats-card";

/* ──────────────────────────────────────────────────────────────── */
/* Helpers                                                          */
/* ──────────────────────────────────────────────────────────────── */

/** Human-readable role label key – matches `roles.*` in es.json */
function roleLabelKey(sessionRole: string): string {
  const map: Record<string, string> = {
    CASHIER: "roles.cashier",
    INVENTORY_ASSISTANT: "roles.inventory_assistant",
    MANAGER: "roles.manager",
    ACCOUNTANT: "roles.accountant",
    OWNER: "roles.owner",
    ADMIN: "roles.owner",
    SAAS_ADMIN: "roles.saas_admin",
  };
  return map[sessionRole] ?? "roles.cashier";
}

/** Subtitle key for the welcome header per role */
function subtitleKey(sessionRole: string): string {
  const map: Record<string, string> = {
    CASHIER: "home.subtitle_cashier",
    INVENTORY_ASSISTANT: "home.subtitle_inventory",
    MANAGER: "home.subtitle_manager",
    ACCOUNTANT: "home.subtitle_accountant",
    OWNER: "home.subtitle_owner",
    ADMIN: "home.subtitle_owner",
    SAAS_ADMIN: "home.subtitle_owner",
  };
  return map[sessionRole] ?? "home.subtitle_cashier";
}

/** Stagger delay for entrance animations */
const STAGGER_BASE = 0.06;

/* ──────────────────────────────────────────────────────────────── */
/* Component                                                        */
/* ──────────────────────────────────────────────────────────────── */

export const Home: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const shouldReduceMotion = useReducedMotion();
  const isOnline = useOnlineStatus();

  const session = useLocalSessionStore((s) => s.session);
  const role = session?.role ?? "";
  // Exact-role checks (not hierarchy) for exclusive sections
  const isPureCashier = role === "CASHIER";
  const isPureInventory = role === "INVENTORY_ASSISTANT";
  const isPureAccountant = role === "ACCOUNTANT";
  // Hierarchy checks for management-level content
  // NOTE: MANAGER and ACCOUNTANT share hierarchy level 1, so hasMinRole(MANAGER)
  // returns true for both. We exclude ACCOUNTANT from full manager section.
  const isManagerOrAbove = hasMinRole(session, RoleType.MANAGER);

  // If there's no session, render nothing (App.tsx handles redirect to login).
  if (!session) {
    return null;
  }

  const roleLabel = t(roleLabelKey(role));
  const subtitle = t(subtitleKey(role));

  // Motion variants — collapsed when reduced motion is on
  const fadeUp = shouldReduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  /* ─── Cashier section: shift info + today stats ─── */
  const cashierSection = isPureCashier && (
    <motion.section
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-pos-md"
      {...fadeUp}
      transition={{ delay: STAGGER_BASE * 3, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <StatsCard
        label={t("home.today_stats")}
        value="—"
        icon={ShoppingCart}
        description={t("home.transactions") + ": 0"}
        numeric
      />
      <StatsCard
        label={t("home.active_shift")}
        value="—"
        icon={Clock}
        description={session.fullName}
      />
      <StatsCard
        label={t("home.sync_status")}
        value={isOnline ? t("sync.state_online") : t("sync.state_offline")}
        icon={isOnline ? Wifi : WifiOff}
        description={
          isOnline
            ? t("home.sync_healthy")
            : t("home.sync_offline")
        }
        className={!isOnline ? "[--ring-color:var(--color-sync)]" : ""}
      />
      <button
        type="button"
        onClick={() => dispatch(navigateToSales())}
        className="pos-button pos-button-primary flex items-center justify-center gap-pos-sm min-h-[100px]"
      >
        <ShoppingCart size={24} strokeWidth={1.5} aria-hidden="true" />
        <span className="text-ui font-bold">{t("home.new_sale")}</span>
      </button>
    </motion.section>
  );

  /* ─── Inventory section: alerts ─── */
  const inventorySection = isPureInventory && !isManagerOrAbove && (
    <motion.section
      className="pos-panel p-pos-lg"
      {...fadeUp}
      transition={{ delay: STAGGER_BASE * 4, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <h3 className="text-ui font-semibold mb-pos-md flex items-center gap-pos-sm">
        <AlertTriangle size={18} style={{ color: "var(--color-urgency)" }} aria-hidden="true" />
        {t("home.low_stock_alerts")}
      </h3>
      <div className="flex flex-col gap-pos-xs text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
        <span>⚠ {t("home.near_expiry")}: —</span>
        <span>📦 {t("home.pending_adjustments")}: —</span>
      </div>
    </motion.section>
  );

  /* ─── Manager / Owner section: admin overview (excludes ACCOUNTANT) ─── */
  const managerSection = isManagerOrAbove && role !== "ACCOUNTANT" && (
    <motion.section
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-pos-md"
      {...fadeUp}
      transition={{ delay: STAGGER_BASE * 4, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <StatsCard
        label={t("home.active_users")}
        value="—"
        icon={Users}
        description={t("home.shift_status")}
      />
      <StatsCard
        label={t("home.sync_status")}
        value={isOnline ? t("sync.state_online") : t("sync.state_offline")}
        icon={isOnline ? Wifi : WifiOff}
        description={isOnline ? t("home.sync_healthy") : t("home.sync_offline")}
      />
      <StatsCard
        label={t("home.recent_activity")}
        value={t("home.audit")}
        icon={FileText}
        description="—"
      />
    </motion.section>
  );

  /* ─── Accountant section ─── */
  const accountantSection = isPureAccountant && !isManagerOrAbove && (
    <motion.section
      className="grid grid-cols-1 sm:grid-cols-2 gap-pos-md"
      {...fadeUp}
      transition={{ delay: STAGGER_BASE * 4, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <StatsCard
        label={t("home.fiscal")}
        value="—"
        icon={FileText}
        description={t("home.sync_status")}
      />
      <StatsCard
        label={t("home.sync_status")}
        value={isOnline ? t("sync.state_online") : t("sync.state_offline")}
        icon={isOnline ? Wifi : WifiOff}
        description={isOnline ? t("home.sync_healthy") : t("home.sync_offline")}
      />
    </motion.section>
  );

  return (
    <div className="h-full overflow-y-auto p-pos-xl" role="main" aria-label={t("home.title")}>
      {/* ── Welcome header ── */}
      <motion.div
        className="mb-pos-xl"
        {...fadeUp}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="flex items-center justify-between mb-pos-xs">
          <h1 className="pos-page-title">{t("home.welcome", { name: session.displayName || session.fullName })}</h1>
          <span
            className="pos-badge pos-badge text-caption font-semibold px-pos-sm py-pos-xs rounded-sm"
            style={{
              backgroundColor: "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
              color: "var(--color-pharma)",
            }}
          >
            {roleLabel}
          </span>
        </div>
        <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
          {subtitle}
        </p>
      </motion.div>

      {/* ── Quick actions grid ── */}
      <motion.div
        {...fadeUp}
        transition={{ delay: STAGGER_BASE * 1, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        <QuickActionsCard className="mb-pos-xl" />
      </motion.div>

      {/* ── Cashier-specific section ── */}
      {cashierSection}

      {/* ── Inventory-specific section ── */}
      {inventorySection}

      {/* ── Manager / Owner section ── */}
      {managerSection}

      {/* ── Accountant section ── */}
      {accountantSection}

      {/* ── Fallback for roles without custom section ── */}
      {!isPureCashier && !isPureInventory && !isManagerOrAbove && !isPureAccountant && (
        <motion.p
          className="text-body-sm mt-pos-xl"
          style={{ color: "var(--color-ink-muted)" }}
          {...fadeUp}
          transition={{ delay: STAGGER_BASE * 5, duration: 0.3 }}
        >
          {t("home.title")}
        </motion.p>
      )}
    </div>
  );
};
