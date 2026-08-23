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
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type Ref,
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
import { CommissionBadge } from "@/components/common/commission-badge";
import { PinIcon } from "@/components/ui/icons";

interface ProductSearchResultsProps {
  results: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
  /** Called when Escape is pressed inside the results list */
  onEscape?: () => void;
  /** Pin/unpin a product to the quick buttons row. */
  onTogglePin?: (productId: string) => void;
  /** Whether a product is currently pinned to the quick buttons row. */
  isPinned?: (productId: string) => boolean;
  /**
   * External ref to the listbox element: the search screen focuses it on
   * ArrowDown from the input so the listbox's own keydown handles arrows.
   */
  listboxRef?: Ref<HTMLDivElement>;
}

export const ProductSearchResults: FC<ProductSearchResultsProps> = ({
  results,
  onSelect,
  onEscape,
  onTogglePin,
  isPinned,
  listboxRef,
}) => {
  const { t } = useTranslation();
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
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
          // Only act when the listbox itself is the target: focused cards
          // handle Enter/Space in their own keydown handler, and acting on
          // bubbled events would double-add (and would hijack any nested
          // control such as the pin button).
          if (event.target !== event.currentTarget) break;
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
      ref={listboxRef}
      tabIndex={-1}
      className="flex flex-col gap-pos-sm focus-visible:outline-none"
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
        const pinned = isPinned?.(item.id) ?? false;

        return (
          <ProductResultCard
            key={item.id}
            item={item}
            restricted={restricted}
            lowStock={lowStock}
            nearExpiry={nearExpiry}
            justAdded={justAdded}
            isFocused={isFocused}
            pinned={pinned}
            onSelect={handleSelect}
            onTogglePin={onTogglePin}
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
  pinned: boolean;
  onSelect: (item: CatalogItem) => void;
  onTogglePin?: (productId: string) => void;
}

const ProductResultCard = forwardRef<HTMLDivElement, ProductResultCardProps>(({
  item,
  restricted,
  lowStock,
  nearExpiry,
  justAdded,
  isFocused,
  pinned,
  onSelect,
  onTogglePin,
}, cardRef) => {
  const { t } = useTranslation();

  const isSelectable = item.hasCompleteData && item.unitPriceCents !== null;

  const handleClick = () => {
    if (isSelectable) {
      onSelect(item);
    }
  };

  const handleTogglePin = () => {
    onTogglePin?.(item.id);
  };

  // Individual Enter/Space for direct keyboard activation (roving tabindex approach)
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Only the card itself activates selection — bubbled events from nested
    // controls (pin button) must keep their native behavior.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isSelectable) {
        onSelect(item);
      }
    }
  };

  // Set up forwarded ref
  useEffect(() => {
    const ref = cardRef as MutableRefObject<HTMLDivElement | null>;
    if (isFocused && ref.current) {
      ref.current.focus({ preventScroll: true });
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
      className={`rounded-pos border bg-panel p-pos-md transition-all duration-200 scroll-mt-pos-sm scroll-mb-pos-sm ${
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
        </div>
        <div className="flex flex-col items-end gap-1">
          {isSelectable && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleTogglePin();
              }}
              aria-label={t(
                pinned
                  ? "sales.quick_buttons.unpin"
                  : "sales.quick_buttons.pin",
              )}
              aria-pressed={pinned}
              title={t(
                pinned
                  ? "sales.quick_buttons.unpin"
                  : "sales.quick_buttons.pin",
              )}
              className="rounded p-1 transition-colors hover:bg-pharma/10"
              style={{
                color: pinned
                  ? "var(--color-pharma)"
                  : "color-mix(in srgb, var(--color-ink) 35%, transparent)",
              }}
            >
              <PinIcon size={14} aria-hidden="true" />
            </button>
          )}
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
        <CommissionBadge
          commissionType={item.commissionType}
          commissionValue={item.commissionValue}
          commissionStartsAt={item.commissionStartsAt}
          commissionEndsAt={item.commissionEndsAt}
        />
      </div>
    </div>
  );
});
