/**
 * LotSearchPanel — search card with input, search action, empty state, and
 * clickable lot results list with selection highlighting.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { DisplayLot } from "./inventory-adjustments.types";

interface LotSearchPanelProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isProcessing: boolean;
  hasSearched: boolean;
  lots: DisplayLot[];
  selectedLot: DisplayLot | null;
  onSelectLot: (lot: DisplayLot) => void;
}

export const LotSearchPanel: FC<LotSearchPanelProps> = ({
  searchQuery,
  onSearchQueryChange,
  onSearch,
  onKeyDown,
  isProcessing,
  hasSearched,
  lots,
  selectedLot,
  onSelectLot,
}) => {
  const { t } = useTranslation();

  const isLowStock = (stock: number): boolean => stock <= 10;

  return (
    <section className="pos-panel p-pos-md" role="search">
      {/* Label */}
      <label
        htmlFor="lot-search-input"
        className="mb-pos-sm block text-body-sm font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("inventory_adjustments.search_label")}
      </label>

      {/* Search row */}
      <div className="flex gap-pos-sm">
        <input
          id="lot-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("inventory_adjustments.search_placeholder")}
          disabled={isProcessing}
          className="pos-input flex-1"
          aria-describedby="lot-search-hint"
        />
        <button
          type="button"
          onClick={onSearch}
          disabled={isProcessing}
          className="pos-button pos-button-primary flex-shrink-0"
        >
          {t("common.search")}
        </button>
      </div>

      {/* Empty results */}
      {hasSearched && lots.length === 0 && (
        <p
          className="mt-pos-md text-body-sm"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          }}
        >
          {t("inventory_adjustments.no_results")}
        </p>
      )}

      {/* Lot results list */}
      {lots.length > 0 && (
        <ul className="mt-pos-md space-y-pos-xs" role="listbox" aria-label={t("inventory_adjustments.search_label")}>
          {lots.map((lot) => {
            const isSelected = selectedLot?.id === lot.id;
            return (
              <li
                key={lot.id}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => onSelectLot(lot)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectLot(lot);
                  }
                }}
                className="cursor-pointer rounded-pos px-pos-md py-pos-sm transition-colors duration-100"
                style={{
                  backgroundColor: isSelected
                    ? "color-mix(in srgb, var(--color-pharma) 8%, transparent)"
                    : "transparent",
                  borderLeft: isSelected
                    ? "3px solid var(--color-pharma)"
                    : "3px solid transparent",
                }}
              >
                {/* Product name */}
                <p
                  className="text-body font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {lot.productName}
                </p>

                {/* Details row */}
                <div className="mt-pos-xs flex flex-wrap gap-x-pos-lg gap-y-pos-xs text-caption">
                  <span className="font-data tabular-nums">
                    {t("inventory_adjustments.lot_code")}: {lot.lotCode}
                  </span>

                  <span
                    className={`font-data tabular-nums ${
                      isLowStock(lot.currentStock) ? "" : ""
                    }`}
                    style={{
                      color: isLowStock(lot.currentStock)
                        ? "var(--color-urgency)"
                        : "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                      fontWeight: isLowStock(lot.currentStock)
                        ? "var(--font-weight-semibold)"
                        : "var(--font-weight-normal)",
                    }}
                  >
                    {t("inventory_adjustments.stock")}: {lot.currentStock}
                  </span>

                  <span
                    style={{
                      color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                    }}
                  >
                    {t("inventory_adjustments.expires")}:{" "}
                    <span className="font-data tabular-nums">
                      {lot.expirationDate}
                    </span>
                  </span>

                  <span
                    style={{
                      color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                    }}
                  >
                    {t("inventory_adjustments.location")}: {lot.location}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
