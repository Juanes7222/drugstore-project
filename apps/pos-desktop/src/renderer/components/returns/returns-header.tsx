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

interface ReturnsHeaderProps {
  /** Whether the terminal currently has a network connection. */
  isOnline: boolean;
  /** Called when the user clicks the back arrow. */
  onBack: () => void;
}

const BackArrowIcon: FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

export const ReturnsHeader: FC<ReturnsHeaderProps> = ({
  isOnline,
  onBack,
}) => {
  const { t } = useTranslation();

  return (
    <header
      className="flex items-center justify-between px-pos-xl py-pos-md"
      style={{
        borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
        backgroundColor: "var(--color-panel)",
      }}
    >
      {/* Left: back button + title */}
      <div className="flex items-center gap-pos-md">
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
          <BackArrowIcon />
        </button>
        <h1 className="pos-page-title">{t("returns.title")}</h1>
      </div>

      {/* Right: online/offline indicator */}
      <div
        className="flex items-center gap-pos-xs tabular-nums"
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
