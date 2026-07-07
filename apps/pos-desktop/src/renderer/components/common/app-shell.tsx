/**
 * Application shell shared by every screen in the POS.
 *
 * Owns the persistent cash-shift header and the Ambient Sync Pulse. It renders
 * around the active screen content and has no knowledge of sales, payment, or
 * inventory logic.
 */
import { type FC, type ReactNode, useState } from "react";
import { CashShiftHeader } from "./cash-shift-header";
import { SyncPulse, SyncState } from "./sync-pulse";

interface AppShellProps {
  cashierName: string;
  openingBalanceCents: number;
  openedAt: string;
  initialSyncState?: SyncState;
  children: ReactNode;
}

export const AppShell: FC<AppShellProps> = ({
  cashierName,
  openingBalanceCents,
  openedAt,
  initialSyncState = "online",
  children,
}) => {
  const [syncState, setSyncState] = useState<SyncState>(initialSyncState);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <CashShiftHeader
        cashierName={cashierName}
        openingBalanceCents={openingBalanceCents}
        openedAt={openedAt}
        syncState={syncState}
        onSyncStateChange={setSyncState}
      />
      <SyncPulse state={syncState} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
};
