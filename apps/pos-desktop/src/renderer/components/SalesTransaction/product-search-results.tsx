/**
 * List of product search results rendered as selectable cards.
 *
 * Each result exposes keyboard navigation (Tab + Enter) and mouse selection.
 * Results with incomplete server data (e.g. missing price/tax) are visible but
 * cannot be added to the cart, because selling a product without a known price
 * would be unsafe.
 */
import { type FC, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  CatalogItem,
  isCatalogItemRestricted,
  isLowStock,
  isNearExpiry,
} from "@/services/catalog-service";
import { formatCurrency } from "@/utils/format-currency";
import { formatShortDate } from "@/utils/format-date";

interface ProductSearchResultsProps {
  results: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
}

export const ProductSearchResults: FC<ProductSearchResultsProps> = ({
  results,
  onSelect,
}) => {
  const { t } = useTranslation();

  if (results.length === 0) {
    return (
      <p
        className="text-caption"
        style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
      >
        {t("sales.search.no_results")}
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-pos-sm"
      role="listbox"
      aria-label={t("sales.search.results")}
    >
      {results.map((item) => {
        const restricted = isCatalogItemRestricted(item);
        const lowStock = isLowStock(item);
        const nearExpiry = isNearExpiry(item.lotExpirationDate);

        return (
          <ProductResultCard
            key={item.id}
            item={item}
            restricted={restricted}
            lowStock={lowStock}
            nearExpiry={nearExpiry}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
};

interface ProductResultCardProps {
  item: CatalogItem;
  restricted: boolean;
  lowStock: boolean;
  nearExpiry: boolean;
  onSelect: (item: CatalogItem) => void;
}

const ProductResultCard: FC<ProductResultCardProps> = ({
  item,
  restricted,
  lowStock,
  nearExpiry,
  onSelect,
}) => {
  const { t } = useTranslation();

  const isSelectable = item.hasCompleteData && item.unitPriceCents !== null;

  const handleClick = () => {
    if (isSelectable) {
      onSelect(item);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isSelectable) {
        onSelect(item);
      }
    }
  };

  return (
    <div
      role="option"
      tabIndex={isSelectable ? 0 : -1}
      aria-disabled={!isSelectable}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`rounded-pos border border-ink/10 bg-panel p-pos-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma ${
        isSelectable
          ? "cursor-pointer hover:bg-surface"
          : "cursor-not-allowed opacity-70"
      }`}
      style={{
        borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-pos-md">
        <div className="flex-1">
          <p
            className="text-body font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {item.name}
          </p>
          <p
            className="text-caption"
            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
          >
            {item.genericName}
          </p>
        </div>
        <div className="text-right">
          <p className="font-data text-price font-semibold tabular-nums">
            {item.unitPriceCents !== null
              ? formatCurrency(item.unitPriceCents)
              : t("sales.product.price_unavailable")}
          </p>
          <p
            className="text-caption"
            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
          >
            {t("sales.product.lot")}: {item.lotCode} — {t("sales.product.expires")}:{" "}
            {formatShortDate(item.lotExpirationDate)}
          </p>
        </div>
      </div>

      <div className="mt-pos-sm flex flex-wrap items-center gap-pos-sm">
        <span
          className="text-caption"
          style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}
        >
          {t("sales.product.stock")}:{" "}
          <span className="font-data tabular-nums">{item.currentStock}</span>
        </span>
        {!item.hasCompleteData && (
          <span
            className="pos-badge"
            style={{
              backgroundColor: "color-mix(in srgb, var(--color-sync) 12%, white)",
              color: "var(--color-sync)",
            }}
          >
            {t("sales.product.incomplete_data")}
          </span>
        )}
        {lowStock && (
          <span className="pos-badge pos-badge-urgency">
            {t("sales.product.low_stock")}
          </span>
        )}
        {nearExpiry && (
          <span className="pos-badge pos-badge-urgency">
            {t("sales.product.near_expiry")}
          </span>
        )}
        {restricted && (
          <span className="pos-badge pos-badge-restrict">
            {t("sales.product.restricted")}
          </span>
        )}
      </div>
    </div>
  );
};
