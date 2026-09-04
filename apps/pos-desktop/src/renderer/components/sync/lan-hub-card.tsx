/**
 * Card showing Hub LAN status for the Sync Health dashboard.
 *
 * Presentational only — receives all values via props. Five visual states:
 *  - connected → green dot + hub identity + address
 *  - no hub    → amber dot + single-store hint
 *  - disconnected/error → red dot + lastSyncError
 *  - backoff   → calm Sync Slate + waiting message (hub known, Rust asked
 *    us to pause after repeated failures; the next cycle retries alone —
 *    never error red, never an operator action)
 *  - duplicate → hard Urgency Amber warning + translated
 *    `DUPLICATE_WORKSTATION_ID:<n>` message (another terminal shares this
 *    station ID, N moves skipped — operator must assign a unique ID)
 *
 * Second line always shows LAN relay activity (last 5 min) plus
 * pendingNotRelayed context.
 *
 * @category Component
 */

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { AlertTriangleIcon, ClockIcon, NetworkIcon, RadioIcon, WifiIcon, WifiOffIcon } from "@/components/ui/icons";
import type { HubInfo, LocalSyncConnectionStatus } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LanCounts {
  pendingLanRelayed: number;
  pendingNotRelayed: number;
  lanRelayedLast5Min: number;
}

export interface LanHubCardProps {
  /** Currently elected hub, or null when operating as single store. */
  currentHub: HubInfo | null;
  /** Connection status to the LAN hub. */
  status: LocalSyncConnectionStatus;
  /** LAN-aware queue counts — may be null while loading. */
  lanCounts: LanCounts | null;
  /** ISO timestamp of last successful LAN sync. */
  lastSyncAt: string | null;
  /** Last sync error message, if any. */
  lastSyncError?: string | null;
  /** Number of discovered peers on the LAN. */
  peersCount?: number;
  /**
   * True while the LAN engine reports `skipped-backoff` (hub known but the
   * Rust side asked us to wait; the next scheduled cycle retries alone).
   * Optional so existing callers keep working — defaults to false. The card
   * also recognises a literal `"skipped-backoff"` lastSyncError as the same
   * signal, in case a future wiring surfaces the outcome that way.
   */
  isBackoff?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLastSync(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Code-style store error for a duplicated workstation identity:
 * `DUPLICATE_WORKSTATION_ID:<n>`. Returns the skipped-moves count, or null
 * when the error is anything else. The raw code is never shown — the card
 * renders `sync.duplicate_workstation_id` instead.
 */
const DUPLICATE_WORKSTATION_RE = /^DUPLICATE_WORKSTATION_ID:(\d+)\s*$/;

function parseDuplicateWorkstationId(error: string | null | undefined): number | null {
  if (!error) return null;
  const match = error.trim().match(DUPLICATE_WORKSTATION_RE);
  if (!match) return null;
  const count = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(count) ? count : null;
}

/** Literal outcome string treated as a backoff signal (see `isBackoff`). */
function isBackoffSignal(error: string | null | undefined): boolean {
  return (error ?? "").trim().toLowerCase() === "skipped-backoff";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LanHubCard: FC<LanHubCardProps> = ({
  currentHub,
  status,
  lanCounts,
  lastSyncAt,
  lastSyncError,
  peersCount = 0,
  isBackoff = false,
}) => {
  const { t } = useTranslation();

  const hasHub = currentHub !== null;
  const isConnected = hasHub && status === "CONNECTED";
  const isReconnecting = hasHub && status === "RECONNECTING";

  // Hard warning first: a duplicated station ID silently drops a peer's
  // operations, so it outranks every other state until fixed.
  const duplicateCount = parseDuplicateWorkstationId(lastSyncError);
  // Calm waiting state: hub known, Rust backoff active, retry is automatic.
  const backoffActive =
    hasHub && duplicateCount == null && (isBackoff || isBackoffSignal(lastSyncError));

  // Derive visual variant
  type Variant = "connected" | "no-hub" | "disconnected" | "reconnecting" | "backoff" | "duplicate";
  let variant: Variant;
  if (duplicateCount != null) variant = "duplicate";
  else if (!hasHub) variant = "no-hub";
  else if (backoffActive) variant = "backoff";
  else if (isConnected) variant = "connected";
  else if (isReconnecting) variant = "reconnecting";
  else variant = "disconnected";

  const variantConfig: Record<
    Variant,
    { borderClass: string; dotClass: string; dotAnimate: boolean; icon: typeof NetworkIcon; iconColor: string }
  > = {
    connected: {
      borderClass: "border-l-success",
      dotClass: "bg-success",
      dotAnimate: false,
      icon: NetworkIcon,
      iconColor: "text-success",
    },
    "no-hub": {
      borderClass: "border-l-warning",
      dotClass: "bg-warning",
      dotAnimate: false,
      icon: WifiIcon,
      iconColor: "text-warning",
    },
    disconnected: {
      borderClass: "border-l-error",
      dotClass: "bg-error",
      dotAnimate: false,
      icon: WifiOffIcon,
      iconColor: "text-error",
    },
    reconnecting: {
      borderClass: "border-l-warning",
      dotClass: "bg-warning",
      dotAnimate: true,
      icon: RadioIcon,
      iconColor: "text-warning",
    },
    backoff: {
      borderClass: "border-l-sync",
      dotClass: "bg-sync",
      dotAnimate: false,
      icon: ClockIcon,
      iconColor: "text-sync",
    },
    duplicate: {
      borderClass: "border-l-warning",
      dotClass: "bg-warning",
      dotAnimate: false,
      icon: AlertTriangleIcon,
      iconColor: "text-warning",
    },
  };

  const cfg = variantConfig[variant];
  const StatusIcon = cfg.icon;

  // Hub identity line
  let primaryLine: string;
  if (duplicateCount != null) {
    if (hasHub) {
      // Neutral identity only — the warning block below carries the message,
      // so this line never claims a connection state it cannot prove.
      const hubLabel = currentHub.friendlyName || currentHub.workstationId;
      const addr = `${currentHub.ipAddress}:${currentHub.port}`;
      primaryLine = `Hub: ${hubLabel} — ${addr}`;
    } else {
      primaryLine = t("sync.lan_no_hub");
    }
  } else if (!hasHub) {
    primaryLine = t("sync.lan_no_hub");
  } else if (variant === "backoff") {
    const hubLabel = currentHub.friendlyName || currentHub.workstationId;
    const addr = `${currentHub.ipAddress}:${currentHub.port}`;
    let waiting = t("sync.lan_backoff_waiting", {
      defaultValue: "En espera — reintento automático",
    });
    if (waiting === "sync.lan_backoff_waiting") {
      waiting = "En espera — reintento automático";
    }
    primaryLine = `Hub: ${hubLabel} — ${addr} • ${waiting}`;
  } else if (variant === "disconnected" || variant === "reconnecting") {
    const hubLabel = currentHub.friendlyName || currentHub.workstationId;
    const addr = `${currentHub.ipAddress}:${currentHub.port}`;
    const statusLabel =
      variant === "reconnecting" ? t("sync.lan_reconnecting") : t("sync.lan_disconnected");
    primaryLine = `Hub: ${hubLabel} — ${addr} • ${statusLabel}`;
  } else {
    const hubLabel = currentHub.friendlyName || currentHub.workstationId;
    const addr = `${currentHub.ipAddress}:${currentHub.port}`;
    primaryLine = t("sync.lan_connected", {
      name: hubLabel,
      address: addr,
      defaultValue: `Hub: ${hubLabel} — ${addr} • ${t("sync.lan_connected_label")}`,
    });
    // Fallback if interpolation key missing — construct manually
    if (primaryLine === "sync.lan_connected") {
      primaryLine = `Hub: ${hubLabel} — ${addr} • ${t("sync.lan_connected_label", { defaultValue: "Conectado" })}`;
    }
  }

  const lastSyncFormatted = formatLastSync(lastSyncAt);

  // Translated duplicate-identity warning (raw code is never rendered).
  let duplicateMessage: string | undefined;
  if (duplicateCount != null) {
    duplicateMessage = t("sync.duplicate_workstation_id", {
      count: duplicateCount,
      defaultValue: `ID de estación duplicado: otro terminal usa este mismo ID. Se omitieron ${duplicateCount} movimientos — asigne un ID de estación único a cada terminal.`,
    });
    if (duplicateMessage === "sync.duplicate_workstation_id") {
      duplicateMessage = `ID de estación duplicado: otro terminal usa este mismo ID. Se omitieron ${duplicateCount} movimientos — asigne un ID de estación único a cada terminal.`;
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      data-testid="lan-hub-card"
      className={`flex flex-col gap-2 rounded-lg border border-border bg-panel p-4 shadow-pos-panel ${cfg.borderClass} border-l-4`}
      role="status"
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wider text-ink-muted">
          <NetworkIcon className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
          {t("sync.lan_title")}
        </span>
        <StatusIcon className={`h-4 w-4 ${cfg.iconColor}`} aria-hidden="true" />
      </div>

      {/* Primary status line with dot */}
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dotClass} ${cfg.dotAnimate ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p
            className="text-body-sm font-medium leading-snug text-ink"
            data-testid="lan-hub-primary"
          >
            {primaryLine}
          </p>

          {/* Duplicate workstation ID — hard warning, never the raw code */}
          {duplicateMessage != null && (
            <p
              role="alert"
              className="mt-1 text-caption font-medium leading-relaxed text-ink"
              data-testid="lan-hub-duplicate"
            >
              {duplicateMessage}
            </p>
          )}

          {/* No-hub hint */}
          {!hasHub && duplicateCount == null && (
            <p className="mt-0.5 text-caption text-ink-muted">
              {t("sync.lan_no_hub_hint")}
            </p>
          )}

          {/* Error line when disconnected */}
          {hasHub && variant === "disconnected" && duplicateCount == null && lastSyncError && !isBackoffSignal(lastSyncError) && (
            <p
              className="mt-1 truncate text-caption text-error"
              title={lastSyncError}
              data-testid="lan-hub-error"
            >
              {lastSyncError}
            </p>
          )}

          {/* Peers + last sync meta */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
            {typeof peersCount === "number" && (
              <span data-testid="lan-hub-peers">
                {t("sync.lan_peers", {
                  count: peersCount,
                  defaultValue: `${peersCount} nodos en red`,
                })}
              </span>
            )}
            {lastSyncFormatted && hasHub && (
              <span data-testid="lan-hub-last-sync">
                {t("sync.lan_last_sync", {
                  time: lastSyncFormatted,
                  defaultValue: `Últ. sync LAN: ${lastSyncFormatted}`,
                })}
              </span>
            )}
            {currentHub?.isSelf && hasHub && (
              <span className="inline-flex items-center rounded bg-pharma/10 px-1.5 py-0.5 font-medium text-pharma">
                {t("sync.lan_is_self", { defaultValue: "Este equipo" })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* LAN relay activity line */}
      <div className="mt-1 rounded-md bg-surface px-3 py-2">
        <p className="text-caption leading-relaxed text-ink-muted" data-testid="lan-hub-counts">
          <span className="font-medium text-ink">
            {t("sync.lan_replicated_5m", {
              count: lanCounts?.lanRelayedLast5Min ?? 0,
              defaultValue: `Operaciones replicadas en LAN (últ. 5 min): ${lanCounts?.lanRelayedLast5Min ?? 0}`,
            })}
          </span>
          {lanCounts !== null && lanCounts.pendingNotRelayed > 0 && (
            <span className="ml-1">
              {" "}
              ·{" "}
              <span className="font-medium text-warning">
                {t("sync.lan_pending_relay", {
                  count: lanCounts.pendingNotRelayed,
                  defaultValue: `Por replicar: ${lanCounts.pendingNotRelayed}`,
                })}
              </span>
            </span>
          )}
          {lanCounts !== null &&
            lanCounts.pendingNotRelayed === 0 &&
            lanCounts.pendingLanRelayed > 0 && (
              <span className="ml-1 text-success">· {t("sync.lan_all_relayed")}</span>
            )}
        </p>
      </div>
    </motion.div>
  );
};
