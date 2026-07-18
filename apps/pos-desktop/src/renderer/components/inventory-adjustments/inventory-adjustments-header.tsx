/**
 * InventoryAdjustmentsHeader — header bar with back button, title, and
 * online/offline status indicator.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon } from "@/components/ui/icons";

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
        className="pos-button pos-button-secondary shrink-0"
        aria-label={t("common.back")}
      >
        <ArrowLeftIcon size={16} />
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
