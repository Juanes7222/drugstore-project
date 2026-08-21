/**
 * ProductHeader — header bar with back button, title, online/offline status,
 * the optional export menu, a "New Product" action button, and the optional
 * CSV/Excel import button.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, FileSpreadsheetIcon, PlusIcon } from "@/components/ui/icons";
import { ExportMenu } from "../ui/export-menu";
import type { ExportFormat } from "../../../common/export";

interface ProductHeaderProps {
  isOnline: boolean;
  onBack: () => void;
  onCreateNew: () => void;
  /** When provided, renders the import button (role-gated by the page). */
  onImport?: () => void;
  /** When provided, renders the export menu in the header action row. */
  onExport?: (format: ExportFormat) => void;
  isExporting?: boolean;
}

export const ProductHeader: FC<ProductHeaderProps> = ({
  isOnline,
  onBack,
  onCreateNew,
  onImport,
  onExport,
  isExporting = false,
}) => {
  const { t } = useTranslation();

  return (
    <header
      className="flex flex-wrap items-center gap-pos-md px-pos-xl py-pos-lg"
      style={{
        backgroundColor: "var(--color-panel)",
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
      }}
    >
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="pos-button pos-button-secondary flex-shrink-0"
        aria-label={t("common.back")}
      >
        <ArrowLeftIcon size={16} />
      </button>

      {/* Title */}
      <h1 className="pos-page-title min-w-0 flex-1 truncate">
        {t("products.title")}
      </h1>

      {/* Import button */}
      {onImport && (
        <button
          type="button"
          onClick={onImport}
          className="pos-button pos-button-secondary flex shrink-0 items-center gap-pos-xs"
        >
          <FileSpreadsheetIcon size={14} strokeWidth={2} />
          {t("import.open")}
        </button>
      )}

      {/* Export menu */}
      {onExport && (
        <ExportMenu
          onExport={onExport}
          exporting={isExporting}
          className="shrink-0"
        />
      )}

      {/* New product button */}
      <button
        type="button"
        onClick={onCreateNew}
        className="pos-button pos-button-primary flex shrink-0 items-center gap-pos-xs"
      >
        <PlusIcon size={14} strokeWidth={2.5} />
        {t("products.new_product")}
      </button>

      {/* Online/offline status */}
      <span
        className="pos-badge shrink-0"
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
            backgroundColor: isOnline
              ? "var(--color-pharma)"
              : "var(--color-sync)",
          }}
        />
        {isOnline ? t("sync.state_online") : t("sync.state_offline")}
      </span>
    </header>
  );
};
