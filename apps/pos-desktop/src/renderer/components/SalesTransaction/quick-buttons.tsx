/**
 * Quick product buttons — a muted chip row of the cashier's pinned
 * fast-movers, shown above the search input.
 *
 * The first five chips carry a visible F2–F6 kbd mark matching the
 * useSalesKeyboard quick-select mapping, so keyboard discoverability does
 * not depend on hovering. Chips whose product fails to resolve (gone,
 * inactive, incomplete) render nothing and the row silently skips them —
 * a dead fast-mover is rare and not worth interrupting the scan cadence.
 */
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CatalogItem, type CatalogService } from "@/services/catalog-service";
import { formatCurrency } from "@/utils/format-currency";

interface QuickButtonsProps {
  catalogService: CatalogService;
  /** Pinned product ids in insertion order (persisted per terminal). */
  productIds: string[];
  /** Add a pinned product to the cart; resolves the id internally. */
  onAdd: (productId: string) => void;
}

export const QuickButtons: FC<QuickButtonsProps> = ({
  catalogService,
  productIds,
  onAdd,
}) => {
  const { t } = useTranslation();
  const [productsById, setProductsById] = useState<Map<string, CatalogItem>>(
    () => new Map(),
  );

  // Resolve pinned ids to catalog items; silently drop anything gone or
  // incomplete so the row only ever shows clickable chips.
  useEffect(() => {
    let cancelled = false;

    Promise.all(
      productIds.map((id) =>
        catalogService
          .getById(id)
          .then((item) => ({ id, item }))
          .catch(() => ({ id, item: null })),
      ),
    ).then((resolved) => {
      if (cancelled) return;
      const next = new Map<string, CatalogItem>();
      for (const { id, item } of resolved) {
        if (item && item.hasCompleteData && item.unitPriceCents !== null) {
          next.set(id, item);
        }
      }
      setProductsById(next);
    });

    return () => {
      cancelled = true;
    };
  }, [productIds, catalogService]);

  if (productIds.length === 0) {
    return null;
  }

  const chips = productIds
    .map((id, index) => ({ id, index, item: productsById.get(id) }))
    .filter(({ item }) => item !== undefined);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      role="toolbar"
      aria-label={t("sales.quick_buttons.label")}
      className="mb-pos-sm flex items-center gap-pos-sm overflow-x-auto rounded-pos border px-pos-sm py-pos-xs"
      style={{
        borderColor: "color-mix(in srgb, var(--color-pharma) 18%, transparent)",
        backgroundColor:
          "color-mix(in srgb, var(--color-pharma) 4%, transparent)",
      }}
    >
      {chips.map(({ id, index, item }) => {
        const itemName = item?.name ?? "";
        const hasShortcut = index < 5;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onAdd(id)}
            title={
              hasShortcut ? `${itemName} — F${index + 2}` : itemName
            }
            aria-label={
              hasShortcut
                ? `${itemName} — F${index + 2} — ${formatCurrency(item?.unitPriceCents ?? 0)}`
                : `${itemName} — ${formatCurrency(item?.unitPriceCents ?? 0)}`
            }
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 bg-panel px-pos-sm py-1 font-data text-caption-xs tabular-nums transition-colors hover:border-pharma/40 hover:text-pharma"
            style={{ color: "var(--color-ink)" }}
          >
            {hasShortcut && (
              <kbd
                className="rounded border px-1 font-mono text-[10px] leading-none tabular-nums"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--color-ink) 20%, transparent)",
                  color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                }}
              >
                F{index + 2}
              </kbd>
            )}
            <span className="max-w-40 truncate">{itemName}</span>
            <span
              className="shrink-0 font-semibold"
              style={{ color: "var(--color-pharma)" }}
            >
              {formatCurrency(item?.unitPriceCents ?? 0)}
            </span>
          </button>
        );
      })}
    </div>
  );
};