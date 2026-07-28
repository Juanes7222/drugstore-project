/**
 * The Ambient Sync Pulse — the application's signature element.
 *
 * A 2px full-width line rendered below the cash-shift header. State is driven
 * by the `state` prop and matches the three states defined in
 * design-system.md: online, offline, draining.
 *
 * Uses CSS animations for the ambient pulse rhythm (no decorative motion on
 * the critical path) and motion only for the initial mount entrance.
 */
import { type FC } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

export type SyncState = "online" | "offline" | "draining";

interface SyncPulseProps {
  state: SyncState;
}

export const SyncPulse: FC<SyncPulseProps> = ({ state }) => {
  const { t } = useTranslation();

  return (
    <motion.div
      className="sync-pulse-bar"
      data-sync-state={state}
      role="status"
      aria-live="polite"
      aria-label={t("sync.state_label")}
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    />
  );
};
