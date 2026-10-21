/**
 * SyncStatusChip — the header's single sync instrument.
 *
 * Replaces the old manual Online/Offline/Draining button group with a real,
 * read-only status chip: a status dot + label + pending-operations badge.
 * Opening it reveals the store's operating state (cloud connectivity, last
 * sync, local network role) and shortcuts to the sync screens.
 *
 * All data arrives via props from the AppShell, which owns one instance of
 * the online-status and local-sync hooks — this component renders only.
 */
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "../../store/hooks";
import {
  navigateToLocalNetwork,
  navigateToSyncHealth,
} from "../../store/slices/ui-slice";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloudIcon,
  ClockIcon,
} from "@/components/ui/icons";
import { HubStatusIcon } from "@/components/ui/icons/animated";
import { formatShortDate } from "@/utils/format-date";

/** Shape of the AppShell-derived sync view passed down from useLocalSync(). */
export interface SyncChipData {
  status: string;
  isConnected: boolean;
  isReconnecting: boolean;
  isDisconnected: boolean;
  isThisWorkstationHub: boolean;
  hasPendingOps: boolean;
  pendingPushCount: number;
  pendingPullCount: number;
  lastSyncAt: string | number | Date | null;
  currentHub: { friendlyName: string; isSelf: boolean } | null;
}

interface SyncStatusChipProps {
  cloudOnline: boolean;
  localSync: SyncChipData;
}

type ChipTone = "online" | "offline" | "draining";

const TONE_COLOR: Record<ChipTone, string> = {
  online: "var(--color-pharma)",
  offline: "var(--color-sync)",
  draining: "var(--color-urgency)",
};

const formatClock = (value: string | number | Date | null): string => {
  if (value == null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const SyncStatusChip: FC<SyncStatusChipProps> = ({
  cloudOnline,
  localSync,
}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [isOpen, setIsOpen] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);

  const pendingTotal = localSync.pendingPushCount + localSync.pendingPullCount;

  // Chip surface reflects the headline: connectivity first, activity second.
  const tone: ChipTone = !cloudOnline
    ? "offline"
    : pendingTotal > 0
      ? "draining"
      : "online";
  const headline = !cloudOnline
    ? t("sync.chip.offline")
    : pendingTotal > 0
      ? t("sync.chip.syncing")
      : t("sync.chip.online");

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (event: MouseEvent) => {
      if (chipRef.current && !chipRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const openSyncHealth = useCallback(() => {
    setIsOpen(false);
    dispatch(navigateToSyncHealth());
  }, [dispatch]);

  const openLocalNetwork = useCallback(() => {
    setIsOpen(false);
    dispatch(navigateToLocalNetwork());
  }, [dispatch]);

  const hubIconStatus = localSync.isThisWorkstationHub
    ? "connected"
    : localSync.isReconnecting
      ? "electing"
      : localSync.isConnected
        ? "connected"
        : "disconnected";

  const hubLabel = localSync.isThisWorkstationHub
    ? t("sync.chip.hub_self")
    : localSync.isReconnecting
      ? t("sync.chip.reconnecting")
      : localSync.isConnected && localSync.currentHub
        ? t("sync.chip.hub_connected", {
            name: localSync.currentHub.friendlyName,
          })
        : t("sync.chip.disconnected");

  const lastSyncLabel = localSync.lastSyncAt
    ? t("sync.chip.last_synced", {
        time: formatClock(localSync.lastSyncAt),
        date: formatShortDate(
          new Date(localSync.lastSyncAt as string).toISOString(),
        ),
      })
    : t("sync.chip.never_synced");

  return (
    <div ref={chipRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-pos-xs rounded-full border py-pos-xs px-pos-sm transition-colors hover:brightness-95"
        style={{
          borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
          backgroundColor: isOpen
            ? "var(--color-surface-variant)"
            : "transparent",
        }}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={t("sync.chip.title")}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: TONE_COLOR[tone] }}
        />
        <span
          className="text-caption font-medium"
          style={{ color: "var(--color-ink)" }}
        >
          {headline}
        </span>
        {pendingTotal > 0 && (
          <span
            className="font-data text-caption rounded-full px-pos-sm py-0.5"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-urgency) 12%, transparent)",
              color: "var(--color-urgency)",
            }}
          >
            {pendingTotal}
          </span>
        )}
        <ChevronDownIcon
          size={10}
          aria-hidden="true"
          style={{
            color: "var(--color-ink-muted)",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {isOpen && (
        <div
          className="pos-panel absolute right-0 top-full z-50 mt-1 w-72 p-pos-sm"
          style={{
            backgroundColor: "var(--color-panel)",
            border:
              "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
            boxShadow:
              "0 8px 24px color-mix(in srgb, var(--color-ink) 14%, transparent)",
          }}
          role="dialog"
          aria-label={t("sync.chip.title")}
        >
          {/* Cloud — the queue drains here; offline is a normal mode */}
          <p className="text-caption-2 font-semibold uppercase tracking-pos-wide">
            {t("sync.chip.cloud")}
          </p>
          <div
            className="mt-1 flex items-center gap-2"
            style={{
              color: cloudOnline ? "var(--color-pharma)" : "var(--color-sync)",
            }}
          >
            <CloudIcon size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="text-body-sm font-medium">
              {cloudOnline ? t("sync.chip.online") : t("sync.chip.offline")}
            </span>
          </div>
          <p
            className="mt-1.5 text-caption"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {lastSyncLabel}
          </p>
          {!cloudOnline && (
            <p
              className="mt-1 flex items-center gap-1.5 text-caption"
              style={{ color: "var(--color-sync)" }}
            >
              <ClockIcon size={12} strokeWidth={2} aria-hidden="true" />
              {t("sync.chip.offline_hint")}
            </p>
          )}

          {/* Local network — store-side replication */}
          <p
            className="text-caption-2 font-semibold uppercase tracking-pos-wide"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("sync.chip.network")}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <HubStatusIcon status={hubIconStatus} size={16} ariaLabel="" />
            <span
              className="text-body-sm font-medium"
              style={{ color: "var(--color-ink)" }}
            >
              {hubLabel}
            </span>
          </div>
          {pendingTotal > 0 && (
            <p
              className="font-data mt-1.5 text-caption"
              style={{ color: "var(--color-urgency)" }}
            >
              {t("sync.chip.pending_relay", { count: pendingTotal })}
            </p>
          )}

          {/* Shortcuts to the two sync screens */}
          <div
            className="mt-pos-sm flex flex-col gap-0.5"
            style={{
              borderTop:
                "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
              paddingTop: "var(--spacing-pos-sm)",
            }}
          >
            {(
              [
                {
                  key: "queue",
                  label: t("sync.chip.open_queue"),
                  onClick: openSyncHealth,
                },
                {
                  key: "network",
                  label: t("sync.chip.open_network"),
                  onClick: openLocalNetwork,
                },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className="flex items-center justify-between rounded-pos-sm px-pos-sm py-1.5 text-left text-caption font-medium transition-colors hover:brightness-95"
                style={{
                  color: "var(--color-ink)",
                  backgroundColor: "transparent",
                }}
              >
                {item.label}
                <ChevronRightIcon size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
