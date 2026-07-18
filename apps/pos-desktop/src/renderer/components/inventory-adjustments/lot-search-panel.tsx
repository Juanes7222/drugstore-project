/**
 * LotSearchPanel — search input + scrollable inventory lot list.
 *
 * Shows ALL active lots by default, with real-time client-side filtering
 * as the user types.  Handles large lists via CSS overflow scrolling.
 * Near-expiry and low-stock lots are visually flagged per the
 * domain-grounded design mandate.
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SearchIcon } from "@/components/ui/icons";
import type { DisplayLot } from "./inventory-adjustments.types";

interface LotSearchPanelProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  isProcessing: boolean;
  lots: DisplayLot[];
  selectedLot: DisplayLot | null;
  onSelectLot: (lot: DisplayLot) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const isLowStock = (stock: number): boolean => stock <= 10;

/**
 * Returns true if the lot expires within the next 90 days.
 */
const isNearExpiry = (expirationDate: string): boolean => {
  if (!expirationDate) return false;
  const expiry = new Date(expirationDate);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 90);
  return expiry <= cutoff;
};

// ── Component ────────────────────────────────────────────────────────────

export const LotSearchPanel: FC<LotSearchPanelProps> = ({
  searchQuery,
  onSearchQueryChange,
  isProcessing,
  lots,
  selectedLot,
  onSelectLot,
}) => {
  const { t } = useTranslation();
  const hasResults = lots.length > 0;
  const isFiltering = searchQuery.trim().length > 0;

  // Sort: near-expiry lots first, then by product name
  const sortedLots = useMemo(
    () =>
      [...lots].sort((a, b) => {
        const aExpiring = isNearExpiry(a.expirationDate) ? 0 : 1;
        const bExpiring = isNearExpiry(b.expirationDate) ? 0 : 1;
        if (aExpiring !== bExpiring) return aExpiring - bExpiring;
        return a.productName.localeCompare(b.productName);
      }),
    [lots],
  );

  return (
    <section
      className="flex flex-col overflow-hidden"
      role="search"
      aria-label={t("inventory_adjustments.inventory_list")}
    >
      {/* ── Search bar ─────────────────────────────────────────────── */}
      <div className="mb-pos-sm flex items-center gap-pos-sm">
        <div className="relative flex-1">
          <input
            id="lot-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t("inventory_adjustments.search_placeholder")}
            disabled={isProcessing}
            className="pos-input w-full pl-pos-lg"
            aria-describedby="lot-search-hint"
          />
          {/* Search icon */}
          <span
            className="absolute left-pos-sm top-1/2 -translate-y-1/2"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
            }}
          >
            <SearchIcon />
          </span>
        </div>

        {/* Lot count chip */}
        <span
          className="shrink-0 rounded-full px-pos-sm py-pos-xs font-data text-caption tabular-nums"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
          }}
        >
          {lots.length}
        </span>
      </div>

      {/* ── Scrollable lot list ────────────────────────────────────── */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="listbox"
        aria-label={t("inventory_adjustments.inventory_list")}
        tabIndex={0}
      >
        {!hasResults && isFiltering && (
          <div className="flex items-center justify-center py-pos-xl">
            <p
              className="text-body-sm"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              }}
            >
              {t("inventory_adjustments.no_results")}
            </p>
          </div>
        )}

        {!hasResults && !isFiltering && (
          <div className="flex items-center justify-center py-pos-xl">
            <p
              className="text-body-sm"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("inventory_adjustments.no_inventory")}
            </p>
          </div>
        )}

        {sortedLots.map((lot) => {
          const isSelected = selectedLot?.id === lot.id;
          const lowStock = isLowStock(lot.currentStock);
          const nearExpiry = isNearExpiry(lot.expirationDate);

          return (
            <div
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
              className={`mb-pos-xs cursor-pointer rounded-pos px-pos-md py-pos-sm transition-colors duration-100 ${
                isSelected ? "" : "hover:opacity-80"
              }`}
              style={{
                backgroundColor: isSelected
                  ? "color-mix(in srgb, var(--color-pharma) 8%, transparent)"
                  : "color-mix(in srgb, var(--color-ink) 3%, transparent)",
                borderLeft: isSelected
                  ? "3px solid var(--color-pharma)"
                  : "3px solid transparent",
              }}
            >
              {/* Product name row */}
              <div className="flex items-center gap-pos-xs">
                <p
                  className="truncate text-body font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {lot.productName}
                </p>

                {/* Low-stock badge */}
                {lowStock && (
                  <span
                    className="shrink-0 rounded px-pos-xs py-0.5 font-data text-caption font-semibold tabular-nums"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--color-urgency) 12%, transparent)",
                      color: "var(--color-urgency)",
                    }}
                  >
                    {t("inventory_adjustments.badge_low_stock")}
                  </span>
                )}

                {/* Near-expiry badge */}
                {nearExpiry && !lowStock && (
                  <span
                    className="shrink-0 rounded px-pos-xs py-0.5 font-data text-caption font-semibold tabular-nums"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
                      color: "var(--color-warning)",
                    }}
                  >
                    {t("inventory_adjustments.badge_near_expiry")}
                  </span>
                )}
              </div>

              {/* Details row */}
              <div className="mt-pos-xs flex flex-wrap gap-x-pos-lg gap-y-pos-xs text-caption">
                {/* Lot code */}
                <span className="font-data tabular-nums">
                  <span
                    style={{
                      color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                    }}
                  >
                    {t("inventory_adjustments.lot_code")}:
                  </span>{" "}
                  <span style={{ color: "var(--color-ink)" }}>{lot.lotCode}</span>
                </span>

                {/* Stock */}
                <span
                  className="font-data tabular-nums"
                  style={{
                    color: lowStock
                      ? "var(--color-urgency)"
                      : "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                    fontWeight: lowStock
                      ? "var(--font-weight-semibold)"
                      : "var(--font-weight-normal)",
                  }}
                >
                  {t("inventory_adjustments.stock")}: {lot.currentStock}
                </span>

                {/* Expiration */}
                <span
                  style={{
                    color: nearExpiry
                      ? "var(--color-warning)"
                      : "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                    fontWeight: nearExpiry
                      ? "var(--font-weight-semibold)"
                      : "var(--font-weight-normal)",
                  }}
                >
                  {t("inventory_adjustments.expires")}:{" "}
                  <span className="font-data tabular-nums">
                    {lot.expirationDate}
                  </span>
                </span>

                {/* Location */}
                <span
                  style={{
                    color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                  }}
                >
                  {t("inventory_adjustments.location")}: {lot.location || "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
