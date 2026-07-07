/**
 * The Ambient Sync Pulse — the application's signature element.
 *
 * A 2px full-width line rendered below the cash-shift header. State is driven
 * by the `state` prop and matches the three states defined in
 * design-system.md: online, offline, draining.
 */
import { type FC } from "react";

export type SyncState = "online" | "offline" | "draining";

interface SyncPulseProps {
  state: SyncState;
}

export const SyncPulse: FC<SyncPulseProps> = ({ state }) => {
  return (
    <div
      className="sync-pulse-bar"
      data-sync-state={state}
      role="status"
      aria-live="polite"
    />
  );
};
