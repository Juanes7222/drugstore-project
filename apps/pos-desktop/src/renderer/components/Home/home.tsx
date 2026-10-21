/**
 * Home — role-aware dashboard shown after login (bento restructure).
 *
 * The dashboard follows the bento principle: tile size reflects data
 * priority. Each role gets one hero tile (the number that defines its day)
 * plus smaller metric tiles, so hierarchy is carried by the grid itself
 * instead of labels.
 *
 * Composition (per role):
 *   1. Greeting header with role badge + subtitle
 *   2. DIAN certificate reminder (roles that can read fiscal endpoints)
 *   3. Quick actions grid (role-gated shortcuts)
 *   4. Bento stats row — one hero tile + secondary metric tiles, all fed
 *      by real local-database aggregates via useHomeDashboardData
 *
 * Motion: only the initial staggered entrance; `prefers-reduced-motion`
 * collapses it to opacity-only.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ClockIcon,
  FileTextIcon,
  PackageIcon,
  UsersIcon,
} from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { useAppDispatch } from "@/store/hooks";
import { navigateToAuditLog } from "@/store/slices/ui-slice";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth";
import { canAccessScreen } from "../Navigation/screen-access";
import { RoleType } from "@pharmacy/shared-types";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useLocalSync } from "@/hooks/use-local-sync";
import { QuickActionsCard } from "./quick-actions-card";
import { useHomeDashboardData } from "./use-home-dashboard-data";
import { CertificateStatusBanner } from "@/components/fiscal/certificate-status-banner";

/* ──────────────────────────────────────────────────────────────── */
/* Helpers                                                          */
/* ──────────────────────────────────────────────────────────────── */

/** Human-readable role label key — matches `roles.*` in es.json */
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

const formatMoney = (value: number | undefined): string =>
  value === undefined
    ? ""
    : "$" + value.toLocaleString("es-CO", { maximumFractionDigits: 0 });

const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });

/* ──────────────────────────────────────────────────────────────── */
/* Tile primitives (bento anatomy)                                  */
/* ──────────────────────────────────────────────────────────────── */

interface TileShellProps {
  className?: string;
  children: React.ReactNode;
}

const Tile: FC<TileShellProps> = ({ className = "", children }) => (
  <div className={`pos-panel flex flex-col gap-pos-xs p-pos-lg ${className}`}>
    {children}
  </div>
);

interface MetricTileProps {
  label: string;
  value: string | number | undefined;
  icon: IconComponent;
  tone?: "default" | "urgency" | "danger";
  onClick?: () => void;
  /** Stretch the tile across two grid columns (bento emphasis). */
  wide?: boolean;
}

/** Secondary metric tile: small uppercase label + mono tabular figure. */
const MetricTile: FC<MetricTileProps> = ({
  label,
  value,
  icon: Icon,
  tone = "default",
  onClick,
  wide = false,
}) => {
  const toneColor =
    tone === "urgency"
      ? "var(--color-urgency)"
      : tone === "danger"
        ? "var(--color-error)"
        : "var(--color-ink)";
  const interactive = onClick !== undefined;
  const content = (
    <>
      <div className="flex items-center gap-pos-sm">
        <Icon
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ color: "var(--color-ink-muted)" }}
        />
        <span
          className="text-caption font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {label}
        </span>
      </div>
      <span
        className="font-data text-price font-bold tabular-nums"
        style={{ color: toneColor }}
      >
        {value === undefined ? "" : value}
      </span>
    </>
  );

  if (!interactive)
    return <Tile className={wide ? "lg:col-span-2" : ""}>{content}</Tile>;

  return (
    <Tile
      className={`${wide ? "lg:col-span-2" : ""} cursor-pointer transition-shadow duration-150 ease-out hover:shadow-pos-elevated`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col items-start gap-pos-xs text-left focus-visible:outline-2 focus-visible:outline-pharma"
        aria-label={label}
      >
        {content}
      </button>
    </Tile>
  );
};

interface HeroTileProps {
  label: string;
  /** Primary figure (currency). */
  amount: string;
  /** Supporting figure (transaction count). */
  detail: string;
}

/** Hero tile — the biggest tile carries the role's headline number. */
const HeroTile: FC<HeroTileProps> = ({ label, amount, detail }) => (
  <Tile className="row-span-1 justify-between sm:col-span-2">
    <div className="flex items-center gap-pos-sm">
      <ActivityIcon
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{ color: "var(--color-pharma)" }}
      />
      <span
        className="text-caption font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {label}
      </span>
    </div>
    <div>
      <span
        className="font-data text-amount font-bold tabular-nums leading-none"
        style={{ color: "var(--color-ink)" }}
      >
        {amount}
      </span>
      <span
        className="mt-pos-xs block text-caption"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {detail}
      </span>
    </div>
  </Tile>
);

interface SyncTileProps {
  label: string;
  isOnline: boolean;
  pendingCount: number;
  /** Stretch the tile across two grid columns (bento emphasis). */
  wide?: boolean;
}

/** Sync tile — same color language as the shell's SyncStatusChip. */
const SyncTile: FC<SyncTileProps> = ({
  label,
  isOnline,
  pendingCount,
  wide = false,
}) => {
  const { t } = useTranslation();
  const toneColor = !isOnline
    ? "var(--color-sync)"
    : pendingCount > 0
      ? "var(--color-urgency)"
      : "var(--color-pharma)";
  const stateLabel = !isOnline
    ? t("sync.chip.offline")
    : pendingCount > 0
      ? t("sync.chip.syncing")
      : t("sync.chip.online");

  return (
    <Tile className={wide ? "lg:col-span-2" : ""}>
      <div className="flex items-center gap-pos-sm">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: toneColor }}
        />
        <span
          className="text-caption font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {label}
        </span>
      </div>
      <span
        className="text-body-sm font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {stateLabel}
        {pendingCount > 0 && (
          <span
            className="font-data ml-pos-sm tabular-nums"
            style={{ color: "var(--color-urgency)" }}
          >
            {t("home.sync_pending", { count: pendingCount })}
          </span>
        )}
      </span>
    </Tile>
  );
};

/* ──────────────────────────────────────────────────────────────── */
/* Component                                                        */
/* ──────────────────────────────────────────────────────────────── */

export const Home: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const shouldReduceMotion = useReducedMotion();

  const session = useLocalSessionStore((s) => s.session);
  const role = session?.role ?? "";
  const isOnline = useOnlineStatus();
  const localSync = useLocalSync();
  const data = useHomeDashboardData({
    userId: session?.userId ? String(session.userId) : undefined,
  });

  const isPureCashier = role === "CASHIER";
  const isPureInventory = role === "INVENTORY_ASSISTANT";
  const isPureAccountant = role === "ACCOUNTANT";
  const isManagerOrAbove = hasMinRole(session, RoleType.MANAGER);

  const pendingOps = localSync.pendingPushCount + localSync.pendingPullCount;

  if (!session) {
    return null;
  }

  // Motion variants — collapsed when reduced motion is on
  const fadeUp = shouldReduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const roleLabel = t(roleLabelKey(role));
  const subtitle = t(subtitleKey(role));

  /* ─── Cashier: today's revenue (hero) + shift + sync ─── */
  const cashierSection = isPureCashier && (
    <motion.section
      className="grid grid-cols-1 gap-pos-md sm:grid-cols-2 lg:grid-cols-4"
      {...fadeUp}
      transition={{
        delay: STAGGER_BASE * 3,
        duration: 0.3,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <HeroTile
        label={t("home.today_stats")}
        amount={formatMoney(data.salesTodayAmount) || "$0"}
        detail={t("home.transactions_count", { count: data.salesToday })}
      />
      <MetricTile
        label={t("home.active_shift")}
        value={
          data.myOpenShift
            ? formatClock(data.myOpenShift.openedAt)
            : t("home.no_active_shift")
        }
        icon={ClockIcon}
      />
      <SyncTile
        label={t("home.sync_status")}
        isOnline={isOnline}
        pendingCount={pendingOps}
      />
    </motion.section>
  );

  /* ─── Inventory: alert tiles, sized and colored by urgency ─── */
  const inventorySection = isPureInventory && !isManagerOrAbove && (
    <motion.section
      className="grid grid-cols-1 gap-pos-md sm:grid-cols-2 lg:grid-cols-4"
      {...fadeUp}
      transition={{
        delay: STAGGER_BASE * 4,
        duration: 0.3,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <MetricTile
        label={t("home.low_stock_tile")}
        value={data.lowStockLots}
        icon={PackageIcon}
        tone="urgency"
      />
      <MetricTile
        label={t("home.near_expiry_tile")}
        value={data.nearExpiryLots}
        icon={AlertTriangleIcon}
        tone="urgency"
      />
      <MetricTile
        label={t("home.expired_tile")}
        value={data.expiredLots}
        icon={AlertTriangleIcon}
        tone="danger"
      />
      <MetricTile
        label={t("home.draft_adjustments_tile")}
        value={data.draftAdjustments}
        icon={PackageIcon}
      />
    </motion.section>
  );

  /* ─── Manager / Owner: admin overview (excludes ACCOUNTANT) ─── */
  const managerSection = isManagerOrAbove && role !== "ACCOUNTANT" && (
    <motion.section
      className="grid grid-cols-1 gap-pos-md sm:grid-cols-2 lg:grid-cols-4"
      {...fadeUp}
      transition={{
        delay: STAGGER_BASE * 4,
        duration: 0.3,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <HeroTile
        label={t("home.today_stats")}
        amount={formatMoney(data.salesTodayAmount) || "$0"}
        detail={t("home.transactions_count", { count: data.salesToday })}
      />
      <MetricTile
        label={t("home.active_users")}
        value={data.activeUsers}
        icon={UsersIcon}
      />
      <MetricTile
        label={t("home.shift_status")}
        value={data.openShiftsCount}
        icon={ClockIcon}
      />
      <MetricTile
        label={t("home.audit_today_tile")}
        value={data.auditToday}
        icon={FileTextIcon}
        wide
        onClick={() => dispatch(navigateToAuditLog())}
      />
      <SyncTile
        label={t("home.sync_status")}
        isOnline={isOnline}
        pendingCount={pendingOps}
        wide
      />
    </motion.section>
  );

  /* ─── Accountant: fiscal output + sync ─── */
  const accountantSection = isPureAccountant && !isManagerOrAbove && (
    <motion.section
      className="grid grid-cols-1 gap-pos-md sm:grid-cols-2 lg:grid-cols-4"
      {...fadeUp}
      transition={{
        delay: STAGGER_BASE * 4,
        duration: 0.3,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <HeroTile
        label={t("home.invoices_today")}
        amount={String(data.invoicesToday ?? "")}
        detail={t("home.transactions_count", { count: data.salesToday })}
      />
      <MetricTile
        label={t("home.today_stats")}
        value={data.salesToday}
        icon={FileTextIcon}
      />
      <SyncTile
        label={t("home.sync_status")}
        isOnline={isOnline}
        pendingCount={pendingOps}
      />
    </motion.section>
  );

  return (
    <div
      className="h-full overflow-y-auto p-pos-xl"
      role="main"
      aria-label={t("home.title")}
    >
      {/* ── Welcome header ── */}
      <motion.div
        className="mb-pos-xl"
        {...fadeUp}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="mb-pos-xs flex items-center justify-between">
          <h1 className="pos-page-title">
            {t("home.welcome", {
              name: session.displayName || session.fullName,
            })}
          </h1>
          <span
            className="pos-badge text-caption font-semibold"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
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

      {/* ── Persistent DIAN certificate reminder (CERTIFICATE plan) ── */}
      {canAccessScreen(session, "fiscal") && <CertificateStatusBanner />}

      {/* ── Quick actions grid ── */}
      <motion.div
        {...fadeUp}
        transition={{
          delay: STAGGER_BASE * 1,
          duration: 0.3,
          ease: [0.23, 1, 0.32, 1],
        }}
      >
        <QuickActionsCard className="mb-pos-xl" />
      </motion.div>

      {/* ── Role bento rows ── */}
      {cashierSection}
      {inventorySection}
      {managerSection}
      {accountantSection}
    </div>
  );
};
