/**
 * Fiscal page header — title, contingency badge, and tab navigation.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FiscalHeaderProps {
  activeTab: "invoices" | "contingency";
  totalCount: number;
  contingencyMode: boolean;
  onTabChange: (tab: "invoices" | "contingency") => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FiscalHeader: FC<FiscalHeaderProps> = ({
  activeTab,
  totalCount,
  contingencyMode,
  onTabChange,
}) => {
  const { t } = useTranslation();

  return (
    <header className="border-b border-ink/8 bg-panel px-pos-xl py-pos-md">
      <div className="flex flex-wrap items-center justify-between gap-pos-md">
        <h1 className="min-w-0 truncate text-ui text-ink">{t("fiscal.title")}</h1>
        <div className="flex shrink-0 items-center gap-4">
          {contingencyMode && (
            <span className="inline-flex items-center gap-2 rounded bg-danger px-3 py-1 text-sm font-bold text-white">
              <span className="h-2 w-2 rounded-full bg-white" />
              {t("fiscal.contingency_mode")}
            </span>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <nav className="mt-pos-md flex flex-wrap gap-pos-md border-b border-ink/8">
        <button
          type="button"
          className={`pb-2 text-body-sm font-medium transition-colors ${
            activeTab === "invoices"
              ? "border-b-2 border-pharma text-pharma"
              : "text-ink-muted hover:text-ink"
          }`}
          onClick={() => onTabChange("invoices")}
        >
          {t("fiscal.tab_invoices", { count: totalCount })}
        </button>
        <button
          type="button"
          className={`pb-2 text-body-sm font-medium transition-colors ${
            activeTab === "contingency"
              ? "border-b-2 border-pharma text-pharma"
              : "text-ink-muted hover:text-ink"
          }`}
          onClick={() => onTabChange("contingency")}
        >
          {t("fiscal.tab_contingency")}
        </button>
      </nav>
    </header>
  );
};
