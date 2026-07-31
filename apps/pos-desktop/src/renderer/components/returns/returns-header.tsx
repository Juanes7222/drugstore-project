/**
 * ReturnsHeader — top bar for the Returns screen.
 *
 * Renders a back button, the screen title, and an ambient online/offline
 * status indicator that follows the design system's sync-visibility
 * convention (calm and always-visible rather than an alert).
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon } from "@/components/ui/icons";

interface ReturnsHeaderProps {
  /** Whether the terminal currently has a network connection. */
  isOnline: boolean;
  /** Called when the user clicks the back arrow. */
  onBack: () => void;
}



export const ReturnsHeader: FC<ReturnsHeaderProps> = ({
  isOnline,
  onBack,
}) => {
  const { t } = useTranslation();

  return (
    <header
      className="flex flex-wrap items-center justify-between gap-pos-md px-pos-xl py-pos-md"
      style={{
        borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
        backgroundColor: "var(--color-panel)",
      }}
    >
      {/* Left: back button + title */}
      <div className="flex min-w-0 items-center gap-pos-md">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center rounded-pos p-pos-xs"
          aria-label={t("common.back", { defaultValue: "Volver" })}
          style={{
            color: "var(--color-ink)",
            transition: "background-color 100ms ease",
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "color-mix(in srgb, var(--color-surface) 60%, white)";
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "transparent";
          }}
        >
          <ArrowLeftIcon size={20} strokeWidth={2.5} />
        </button>
        <h1 className="pos-page-title min-w-0 truncate">{t("returns.title")}</h1>
      </div>

      {/* Right: online/offline indicator */}
      <div
        className="flex shrink-0 items-center gap-pos-xs tabular-nums"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: isOnline ? "var(--color-pharma)" : "var(--color-sync)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: isOnline ? "var(--color-pharma)" : "var(--color-sync)",
            opacity: isOnline ? 0.8 : 0.6,
            animation: isOnline ? "none" : "var(--animate-sync-pulse)",
          }}
        />
        <span>
          {isOnline ? t("sync.state_online") : t("sync.state_offline")}
        </span>
      </div>
    </header>
  );
};
