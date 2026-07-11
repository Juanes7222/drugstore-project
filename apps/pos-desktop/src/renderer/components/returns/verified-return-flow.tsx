/**
 * VerifiedReturnFlow — sale search, item selection, and verified return
 * submission workflow.
 *
 * The cashier searches for a local sale by number or UUID. When found, the
 * sale items are displayed in a table with checkboxes. Selected items are
 * highlighted and can be submitted for a verified return.
 *
 * Uses the design system's pos-return-table CSS classes for consistent
 * tabular layout with tabular-nums for all monetary columns.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { SaleSearchResult } from "./returns.types";
import { formatCents } from "./returns.types";

interface VerifiedReturnFlowProps {
  /** The current sale search query string. */
  searchQuery: string;
  /** Called when the search input value changes. */
  onSearchQueryChange: (value: string) => void;
  /** Called when the user clicks the search button. */
  onSearch: () => void;
  /** Called when a key is pressed in the search input (for Enter handling). */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Error message to display above the search card, or null. */
  searchError: string | null;
  /** The sale found by the search, or null if none / not yet searched. */
  foundSale: SaleSearchResult | null;
  /** Set of sale-item IDs currently checked for return. */
  selectedItemIds: Set<string>;
  /** Called with the item ID when its checkbox is toggled. */
  onToggleItem: (itemId: string) => void;
  /** Whether a return submission is in progress. */
  isProcessing: boolean;
  /** Called to submit the verified return. */
  onSubmit: () => void;
  /** Whether the submit button should be enabled. */
  canSubmit: boolean;
}

const SearchIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

export const VerifiedReturnFlow: FC<VerifiedReturnFlowProps> = ({
  searchQuery,
  onSearchQueryChange,
  onSearch,
  onKeyDown,
  searchError,
  foundSale,
  selectedItemIds,
  onToggleItem,
  isProcessing,
  onSubmit,
  canSubmit,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-pos-xl">
      {/* ── Sale Search Card ── */}
      <div className="pos-panel p-pos-lg">
        <label
          htmlFor="sale-search-input"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-body-sm)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-ink)",
            marginBottom: "var(--spacing-pos-sm)",
            display: "block",
          }}
        >
          {t("returns.search_label")}
        </label>

        <div className="flex gap-pos-sm">
          <input
            id="sale-search-input"
            type="text"
            className="pos-input"
            placeholder={t("returns.search_placeholder")}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isProcessing}
            autoComplete="off"
            style={{ maxWidth: 360 }}
          />
          <button
            type="button"
            className="pos-button pos-button-primary"
            onClick={onSearch}
            disabled={isProcessing || !searchQuery.trim()}
            aria-label={t("returns.search_label")}
          >
            <SearchIcon />
            <span>{t("returns.search_label")}</span>
          </button>
        </div>

        {/* Search error */}
        {searchError && (
          <p
            role="alert"
            className="mt-pos-sm"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-caption)",
              color: "var(--color-urgency)",
            }}
          >
            {searchError}
          </p>
        )}
      </div>

      {/* ── Sale Details Panel ── */}
      {foundSale && (
        <div className="pos-panel overflow-hidden">
          {/* Sale header */}
          <div
            className="flex items-center justify-between px-pos-lg py-pos-md"
            style={{
              borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          >
            <div className="flex flex-col gap-pos-xs">
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-body-sm)",
                  fontWeight: "var(--font-weight-medium)",
                  color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {t("returns.sale_number")}
              </span>
              <span
                className="font-data tabular-nums"
                style={{
                  fontSize: "var(--text-ui)",
                  fontWeight: "var(--font-weight-bold)",
                  color: "var(--color-ink)",
                }}
              >
                #{foundSale.sequentialNumber}
              </span>
            </div>
            <div className="flex flex-col items-end gap-pos-xs">
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-body-sm)",
                  color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {foundSale.clientName}
              </span>
              <span
                className="font-data tabular-nums"
                style={{
                  fontSize: "var(--text-price)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: "var(--color-ink)",
                }}
              >
                {formatCents(foundSale.totalCents)}
              </span>
            </div>
          </div>

          {/* Items table */}
          <div className="overflow-x-auto">
            <table className="pos-return-table w-full">
              <thead>
                <tr>
                  <th className="pos-return-table__th" style={{ width: 48 }}>
                    <span className="sr-only">{t("returns.select_item")}</span>
                  </th>
                  <th className="pos-return-table__th">
                    {t("returns.table_product")}
                  </th>
                  <th className="pos-return-table__th">
                    {t("returns.table_lot")}
                  </th>
                  <th className="pos-return-table__th pos-return-table__th--numeric">
                    {t("returns.table_qty")}
                  </th>
                  <th className="pos-return-table__th pos-return-table__th--numeric">
                    {t("returns.table_price")}
                  </th>
                  <th className="pos-return-table__th pos-return-table__th--numeric">
                    {t("returns.table_refund")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {foundSale.items.map((item) => {
                  const isSelected = selectedItemIds.has(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`pos-return-table__row ${
                        isSelected ? "pos-return-table__row--selected" : ""
                      }`}
                      onClick={() => onToggleItem(item.id)}
                    >
                      <td className="pos-return-table__td" style={{ width: 48 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleItem(item.id)}
                          aria-label={`${t("returns.select_item")} ${item.productName}`}
                          disabled={isProcessing}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            accentColor: "var(--color-pharma)",
                            cursor: "pointer",
                          }}
                        />
                      </td>
                      <td className="pos-return-table__td font-medium">
                        {item.productName}
                      </td>
                      <td className="pos-return-table__td font-data tabular-nums">
                        {item.lotCode}
                      </td>
                      <td className="pos-return-table__td pos-return-table__td--numeric font-data">
                        {item.quantity}
                      </td>
                      <td className="pos-return-table__td pos-return-table__td--numeric font-data">
                        {formatCents(item.unitPriceCents)}
                      </td>
                      <td className="pos-return-table__td pos-return-table__td--numeric font-data">
                        {formatCents(item.totalCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Process return button */}
          <div
            className="flex justify-end px-pos-lg py-pos-md"
            style={{
              borderTop: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          >
            <button
              type="button"
              className="pos-button pos-button-primary"
              onClick={onSubmit}
              disabled={!canSubmit}
              aria-label={t("returns.process_return")}
            >
              {isProcessing
                ? t("returns.processing")
                : t("returns.process_return")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
