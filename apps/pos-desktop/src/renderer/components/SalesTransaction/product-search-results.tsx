/**
 * List of product search results rendered as selectable cards.
 *
 * Supports keyboard navigation (ArrowUp/ArrowDown to move, Enter/Space to
 * select). When an item is added to the cart, the card briefly shows an
 * "AGREGADO" confirmation badge before fading.
 *
 * Cards with incomplete server data are visible but cannot be selected.
 */
import {
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  type CatalogItem,
  isCatalogItemRestricted,
  isLowStock,
  isNearExpiry,
} from "@/services/catalog-service";
import { formatCurrency } from "@/utils/format-currency";
import { formatShortDate } from "@/utils/format-date";

interface ProductSearchResultsProps {
  results: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
  /** Called when Escape is pressed inside the results list */
  onEscape?: () => void;
}

export const ProductSearchResults: FC<ProductSearchResultsProps> = ({
  results,
  onSelect,
  onEscape,
}) => {
  const { t } = useTranslation();
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Reset focused index when results change
  useEffect(() => {
    setFocusedIndex(-1);
    cardRefs.current = cardRefs.current.slice(0, results.length);
  }, [results]);

  // Scroll focused card into view
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < cardRefs.current.length) {
      cardRefs.current[focusedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
    }
  }, [focusedIndex]);

  const handleSelect = useCallback(
    (item: CatalogItem) => {
      onSelect(item);
      setAddedIds((prev) => new Set(prev).add(item.id));
    },
    [onSelect],
  );

  // Clear "AGREGADO" state after 1.2s
  useEffect(() => {
    if (addedIds.size === 0) return;
    const timer = setTimeout(() => {
      setAddedIds(new Set());
    }, 1200);
    return () => clearTimeout(timer);
  }, [addedIds]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const selectableIndices = results
        .map((item, idx) =>
          item.hasCompleteData && item.unitPriceCents !== null ? idx : -1,
        )
        .filter((idx) => idx >= 0);

      if (selectableIndices.length === 0) return;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const currentPos = selectableIndices.indexOf(focusedIndex);
          const nextPos = Math.min(currentPos + 1, selectableIndices.length - 1);
          setFocusedIndex(selectableIndices[nextPos]);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const currentPos = selectableIndices.indexOf(focusedIndex);
          const prevPos = Math.max(currentPos - 1, 0);
          setFocusedIndex(selectableIndices[prevPos]);
          break;
        }
        case "Escape": {
          event.preventDefault();
          onEscape?.();
          break;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < results.length) {
            const item = results[focusedIndex];
            if (item.hasCompleteData && item.unitPriceCents !== null) {
              handleSelect(item);
            }
          }
          break;
        }
      }
    },
    [results, focusedIndex, handleSelect],
  );

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
      ref={containerRef}
      className="flex flex-col gap-pos-sm"
      role="listbox"
      aria-label={t("sales.search.results")}
      onKeyDown={handleKeyDown}
    >
      {results.map((item, index) => {
        const restricted = isCatalogItemRestricted(item);
        const lowStock = isLowStock(item);
        const nearExpiry = isNearExpiry(item.lotExpirationDate);
        const justAdded = addedIds.has(item.id);
        const isFocused = index === focusedIndex;

        return (
          <ProductResultCard
            key={item.id}
            item={item}
            restricted={restricted}
            lowStock={lowStock}
            nearExpiry={nearExpiry}
            justAdded={justAdded}
            isFocused={isFocused}
            onSelect={handleSelect}
            ref={(el) => {
              cardRefs.current[index] = el;
            }}
          />
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface ProductResultCardProps {
  item: CatalogItem;
  restricted: boolean;
  lowStock: boolean;
  nearExpiry: boolean;
  justAdded: boolean;
  isFocused: boolean;
  onSelect: (item: CatalogItem) => void;
}

const ProductResultCard = forwardRef<HTMLDivElement, ProductResultCardProps>(({
  item,
  restricted,
  lowStock,
  nearExpiry,
  justAdded,
  isFocused,
  onSelect,
}, cardRef) => {
  const { t } = useTranslation();

  const isSelectable = item.hasCompleteData && item.unitPriceCents !== null;

  const handleClick = () => {
    if (isSelectable) {
      onSelect(item);
    }
  };

  // Individual Enter/Space for direct keyboard activation (roving tabindex approach)
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isSelectable) {
        onSelect(item);
      }
    }
  };

  // Set up forwarded ref
  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.focus({ preventScroll: true });
    }
  }, [isFocused]);

  return (
    <div
      ref={cardRef}
      role="option"
      tabIndex={isFocused ? 0 : -1}
      aria-disabled={!isSelectable}
      aria-selected={justAdded}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`rounded-pos border bg-panel p-pos-md transition-all duration-200 ${
        isFocused
          ? "border-pharma/60 ring-2 ring-pharma/20"
          : justAdded
            ? "border-pharma/40 scale-[0.99]"
            : isSelectable
              ? "cursor-pointer border-ink/10 hover:bg-surface hover:border-pharma/20"
              : "cursor-not-allowed border-ink/10 opacity-70"
      }`}
      style={{
        borderColor: isFocused
          ? "var(--color-pharma)"
          : justAdded
            ? "color-mix(in srgb, var(--color-pharma) 40%, transparent)"
            : "color-mix(in srgb, var(--color-ink) 10%, transparent)",
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
        <div className="flex flex-col items-end gap-1">
          {justAdded && (
            <span
              className="rounded px-1.5 py-0.5 text-caption-xs font-semibold uppercase tracking-wide"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-pharma) 12%, white)",
                color: "var(--color-pharma)",
              }}
            >
              {t("sales.added")}
            </span>
          )}
          <p className="font-data text-price font-semibold tabular-nums">
            {item.unitPriceCents !== null
              ? formatCurrency(item.unitPriceCents)
              : t("sales.product.price_unavailable")}
          </p>
          <p
            className="text-caption"
            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
          >
            {t("sales.product.lot")}: {item.lotCode} —{" "}
            {t("sales.product.expires")}: {formatShortDate(item.lotExpirationDate)}
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
});
