/**
 * ReturnTabs — tab selector for choosing between Verified and Unverified
 * return workflows.
 *
 * Follows ARIA tablist pattern for keyboard navigation. The active tab
 * uses either the primary pharma-teal style (verified) or the restrict
 * violet style (unverified) to signal the regulatory weight of each flow.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ReturnTab } from "./returns.types";

interface ReturnTabsProps {
  /** The currently active tab key. */
  activeTab: ReturnTab;
  /** Called when the user clicks a tab. */
  onTabChange: (tab: ReturnTab) => void;
}

export const ReturnTabs: FC<ReturnTabsProps> = ({ activeTab, onTabChange }) => {
  const { t } = useTranslation();

  const tabs: { key: ReturnTab; labelKey: string }[] = [
    { key: "verified", labelKey: "returns.verified_tab" },
    { key: "unverified", labelKey: "returns.unverified_tab" },
  ];

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, tab: ReturnTab) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onTabChange(tab);
      }
    },
    [onTabChange],
  );

  return (
    <div
      role="tablist"
      aria-label={t("returns.flow_selector")}
      className="flex"
      style={{
        borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      {tabs.map(({ key, labelKey }) => {
        const isActive = activeTab === key;
        const isUnverified = key === "unverified";

        return (
          <button
            key={key}
            role="tab"
            aria-selected={isActive}
            type="button"
            className="px-pos-xl py-pos-sm"
            onClick={() => onTabChange(key)}
            onKeyDown={(e) => handleKeyDown(e, key)}
            tabIndex={isActive ? 0 : -1}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-body)",
              fontWeight: isActive
                ? "var(--font-weight-semibold)"
                : "var(--font-weight-normal)",
              color: isActive
                ? isUnverified
                  ? "var(--color-restrict)"
                  : "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              backgroundColor: "transparent",
              border: "none",
              borderBottom: isActive ? "2px solid" : "2px solid transparent",
              borderBottomColor: isActive
                ? isUnverified
                  ? "var(--color-restrict)"
                  : "var(--color-pharma)"
                : "transparent",
              cursor: "pointer",
              transition:
                "color 100ms ease, border-bottom-color 100ms ease",
            }}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
};
