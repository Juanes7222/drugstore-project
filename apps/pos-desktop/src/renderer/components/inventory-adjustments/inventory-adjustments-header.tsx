/**
 * InventoryAdjustmentsHeader — header bar with back button, title, and
 * online/offline status indicator.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";

interface InventoryAdjustmentsHeaderProps {
  isOnline: boolean;
  onBack: () => void;
}

export const InventoryAdjustmentsHeader: FC<InventoryAdjustmentsHeaderProps> = ({
  isOnline,
  onBack,
}) => {
  const { t } = useTranslation();

  return (
    <header
      className="flex items-center gap-pos-md px-pos-xl py-pos-lg"
      style={{
        backgroundColor: "var(--color-panel)",
        borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
      }}
    >
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="pos-button pos-button-secondary flex-shrink-0"
        aria-label={t("common.back")}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Title */}
      <h1 className="pos-page-title flex-1">{t("inventory_adjustments.title")}</h1>

      {/* Online/offline status */}
      <span
        className="pos-badge"
        style={{
          backgroundColor: isOnline
            ? "color-mix(in srgb, var(--color-pharma) 10%, transparent)"
            : "color-mix(in srgb, var(--color-sync) 10%, transparent)",
          color: isOnline ? "var(--color-pharma)" : "var(--color-sync)",
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{
            backgroundColor: isOnline ? "var(--color-pharma)" : "var(--color-sync)",
          }}
        />
        {isOnline ? t("sync.state_online") : t("sync.state_offline")}
      </span>
    </header>
  );
};
