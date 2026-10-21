/**
 * Application shell shared by every screen in the POS.
 *
 * Owns the persistent header row (cash-shift read + sync chip + QuickSwitch)
 * and the Ambient Sync Pulse. The pulse state is derived from real signals —
 * browser connectivity and the local-sync LAN queue — never from a manual
 * control. It has no knowledge of sales, payment, or inventory logic.
 */
import { type FC, type ReactNode } from "react";
import { CashShiftHeader } from "./cash-shift-header";
import { SyncPulse, SyncState } from "./sync-pulse";
import { SyncAttentionBanner } from "./sync-attention-banner";
import { QuickSwitch } from "../auth/quick-switch.component";
import { SyncStatusChip } from "./sync-status-chip";
import { useOnlineStatus } from "../../hooks/use-online-status";
import { useLocalSync } from "../../hooks/use-local-sync";

interface AppShellProps {
  /** Optional: falls back to current open shift from the cash-shift store. */
  openingBalanceCents?: number;
  /** Optional: falls back to current open shift from the cash-shift store. */
  openedAt?: string;
  children: ReactNode;
}

export const AppShell: FC<AppShellProps> = ({
  openingBalanceCents,
  openedAt,
  children,
}) => {
  const isOnline = useOnlineStatus();
  const localSync = useLocalSync();

  // The pulse mirrors the store's real operating mode:
  //  - browser offline → offline (Slate, calm pulse)
  //  - online with LAN operations awaiting replication → draining
  //  - otherwise → online (Pharma Teal, resting)
  const syncState: SyncState = !isOnline
    ? "offline"
    : localSync.hasPendingOps
      ? "draining"
      : "online";

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <div
        className="flex items-center justify-between gap-pos-sm"
        style={{
          borderBottom:
            "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
        }}
      >
        <CashShiftHeader
          openingBalanceCents={openingBalanceCents}
          openedAt={openedAt}
        />
        <div
          className="flex shrink-0 items-center gap-pos-sm px-pos-md"
          style={{
            borderLeft:
              "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
            alignSelf: "stretch",
          }}
        >
          <SyncStatusChip cloudOnline={isOnline} localSync={localSync} />
          <QuickSwitch />
        </div>
      </div>
      <SyncPulse state={syncState} />
      <SyncAttentionBanner />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
};
