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
  const { t } = useTranslation("fiscal");

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">{t("title")}</h1>
        <div className="flex items-center gap-4">
          {contingencyMode && (
            <span className="inline-flex items-center gap-2 rounded bg-red-600 px-3 py-1 text-sm font-bold text-white">
              <span className="h-2 w-2 rounded-full bg-white" />
              {t("contingency_mode")}
            </span>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <nav className="mt-4 flex gap-4 border-b border-gray-200">
        <button
          type="button"
          className={`pb-2 text-sm font-medium ${
            activeTab === "invoices"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => onTabChange("invoices")}
        >
          {t("tab_invoices", { count: totalCount })}
        </button>
        <button
          type="button"
          className={`pb-2 text-sm font-medium ${
            activeTab === "contingency"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => onTabChange("contingency")}
        >
          {t("tab_contingency")}
        </button>
      </nav>
    </header>
  );
};
