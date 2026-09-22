/**
 * ProductMovementHistoryModal — modal listing every inventory movement a
 * product has had across all its lots, most recent first.
 *
 * Opens from the products view and from right-click context actions in the
 * sales screen (product search results and cart lines). Fetches data through
 * the InventoryLotsService when it becomes visible. Supports filtering by
 * movement type and by an inclusive date range.
 *
 * @category Component
 */
import {
  type FC,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { XIcon } from "@/components/ui/icons";
import { useInventoryLotsService } from "../common/service-context";
import type { ProductMovementRecord } from "../../../domain/inventory-lots/inventory-lots.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Movement type → i18n label key. Falls back to the raw type when the
 * movement predates a new MovementType value (same strategy the audit
 * log and lot history use).
 */
const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  SALE: "product_movements.type_sale",
  PURCHASE_RECEIPT: "product_movements.type_purchase_receipt",
  POSITIVE_ADJUSTMENT: "product_movements.type_positive_adjustment",
  NEGATIVE_ADJUSTMENT: "product_movements.type_negative_adjustment",
  CLIENT_RETURN: "product_movements.type_client_return",
  SUPPLIER_RETURN: "product_movements.type_supplier_return",
  ADMIN_BLOCK: "product_movements.type_admin_block",
  ADMIN_UNBLOCK: "product_movements.type_admin_unblock",
  AUTO_EXPIRATION: "product_movements.type_auto_expiration",
  PHYSICAL_COUNT: "product_movements.type_physical_count",
  INITIAL_STOCK: "product_movements.type_initial_stock",
};

/** Select options, in display order. */
const MOVEMENT_TYPE_OPTIONS = Object.keys(MOVEMENT_TYPE_LABEL);

/** Movement types that increase stock — used for sign colouring. */
const POSITIVE_TYPES = new Set([
  "PURCHASE_RECEIPT",
  "POSITIVE_ADJUSTMENT",
  "CLIENT_RETURN",
  "ADMIN_UNBLOCK",
  "INITIAL_STOCK",
]);

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Date input value → inclusive Date. `from` starts at local midnight,
 * `to` ends at local 23:59:59.999 so both bounds cover the whole day.
 * Returns undefined for an empty string.
 */
function parseDateInput(value: string, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProductMovementHistoryModalProps {
  visible: boolean;
  productId: string | null;
  productName: string;
  onClose: () => void;
}

export const ProductMovementHistoryModal: FC<ProductMovementHistoryModalProps> = ({
  visible,
  productId,
  productName,
  onClose,
}) => {
  const { t } = useTranslation();
  const lotsService = useInventoryLotsService();

  const [movements, setMovements] = useState<ProductMovementRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state — date inputs are kept as raw strings for controlled
  // editing; the parsed inclusive bounds are derived at fetch time.
  const [movementTypeFilter, setMovementTypeFilter] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");

  // Reset filters whenever the modal opens for a different product so a
  // previously chosen filter never silently applies to the next product.
  useEffect(() => {
    if (!visible) return;
    setMovementTypeFilter("");
    setFromInput("");
    setToInput("");
  }, [visible, productId]);

  const loadMovements = useCallback(async () => {
    if (!visible || !productId) return;
    setIsLoading(true);
    setError(null);
    try {
      const records = await lotsService.getMovementsForProduct(productId, {
        movementType: movementTypeFilter || undefined,
        fromDate: parseDateInput(fromInput, false),
        toDate: parseDateInput(toInput, true),
      });
      setMovements(records);
    } catch {
      setError(t("product_movements.load_error"));
    } finally {
      setIsLoading(false);
    }
  }, [visible, productId, lotsService, t, movementTypeFilter, fromInput, toInput]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const hasActiveFilters =
    movementTypeFilter !== "" || fromInput !== "" || toInput !== "";

  const handleClearFilters = useCallback(() => {
    setMovementTypeFilter("");
    setFromInput("");
    setToInput("");
  }, []);

  const getTypeLabel = useCallback(
    (movementType: string): string => {
      const key = MOVEMENT_TYPE_LABEL[movementType];
      return key ? t(key, { defaultValue: movementType }) : movementType;
    },
    [t],
  );

  return (
    <Dialog.Root open={visible} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
          }}
        />

        {/* Content */}
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-pos shadow-pos-elevated"
          style={{ backgroundColor: "var(--color-panel)" }}
          aria-describedby={undefined}
        >
          {/* ---- Header ---- */}
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 10%, transparent)",
            }}
          >
            <div>
              <Dialog.Title
                className="text-ui font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {t("product_movements.title")}
              </Dialog.Title>
              <p
                className="mt-0.5 text-caption"
                style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}
              >
                {productName}
              </p>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-pos transition-colors hover:opacity-70"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
                aria-label={t("common.close")}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* ---- Filter bar ---- */}
          <div
            className="flex flex-wrap items-center gap-pos-sm border-b px-4 py-2"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          >
            {/* Movement type */}
            <select
              value={movementTypeFilter}
              onChange={(e) => setMovementTypeFilter(e.target.value)}
              className="pos-input w-48"
              aria-label={t("product_movements.filter_type_label")}
            >
              <option value="">{t("product_movements.filter_type_all")}</option>
              {MOVEMENT_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {t(MOVEMENT_TYPE_LABEL[type], { defaultValue: type })}
                </option>
              ))}
            </select>

            {/* Date range */}
            <label className="flex items-center gap-pos-xs text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
              {t("product_movements.filter_from")}
              <input
                type="date"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                className="pos-input w-36 font-data tabular-nums"
                aria-label={t("product_movements.filter_from_label")}
              />
            </label>
            <label className="flex items-center gap-pos-xs text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
              {t("product_movements.filter_to")}
              <input
                type="date"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                className="pos-input w-36 font-data tabular-nums"
                aria-label={t("product_movements.filter_to_label")}
              />
            </label>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="pos-button pos-button-secondary px-pos-sm py-pos-xs text-caption"
              >
                {t("product_movements.filter_clear")}
              </button>
            )}

            {/* Count badge */}
            <span
              className="ml-auto flex-shrink-0 rounded-full px-pos-sm py-pos-xs font-data text-caption tabular-nums"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
              }}
            >
              {movements.length}
            </span>
          </div>

          {/* ---- Body ---- */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {/* Loading state */}
            {isLoading && (
              <p
                className="py-pos-sm text-body-sm"
                style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
              >
                {t("common.loading")}
              </p>
            )}

            {/* Error state */}
            {error && (
              <p
                className="py-pos-sm text-body-sm"
                style={{ color: "var(--color-urgency)" }}
                role="alert"
              >
                {error}
              </p>
            )}

            {/* Empty state — message differs when filters hide the rows */}
            {!isLoading && !error && movements.length === 0 && (
              <p
                className="py-pos-sm text-body-sm"
                style={{ color: "color-mix(in srgb, var(--color-ink) 45%, transparent)" }}
              >
                {hasActiveFilters
                  ? t("product_movements.empty_filtered")
                  : t("product_movements.empty")}
              </p>
            )}

            {/* Movement table */}
            {!isLoading && !error && movements.length > 0 && (
              <table className="w-full min-w-[38rem] border-collapse" style={{ color: "var(--color-ink)" }}>
                <thead>
                  <tr
                    className="text-caption font-semibold uppercase tracking-wider"
                    style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}
                  >
                    <th className="px-pos-xs py-pos-xs text-left">{t("product_movements.col_type")}</th>
                    <th className="px-pos-xs py-pos-xs text-left">{t("product_movements.col_lot")}</th>
                    <th className="px-pos-xs py-pos-xs text-right">{t("product_movements.col_qty")}</th>
                    <th className="px-pos-xs py-pos-xs text-right">{t("product_movements.col_stock_before")}</th>
                    <th className="px-pos-xs py-pos-xs text-right">{t("product_movements.col_stock_after")}</th>
                    <th className="px-pos-xs py-pos-xs text-left">{t("product_movements.col_date")}</th>
                    <th className="px-pos-xs py-pos-xs text-left">{t("product_movements.col_reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => {
                    const isPositive = m.quantity > 0 || POSITIVE_TYPES.has(m.movementType);
                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom:
                            "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
                        }}
                      >
                        <td className="px-pos-xs py-pos-xs text-body-sm font-medium whitespace-nowrap">
                          {getTypeLabel(m.movementType)}
                        </td>
                        <td className="px-pos-xs py-pos-xs font-data text-caption tabular-nums" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                          {m.lotBatchNumber ?? "—"}
                        </td>
                        <td
                          className="px-pos-xs py-pos-xs text-right font-data text-body-sm font-semibold tabular-nums"
                          style={{ color: isPositive ? "var(--color-pharma)" : "var(--color-urgency)" }}
                        >
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="px-pos-xs py-pos-xs text-right font-data text-body-sm tabular-nums" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                          {m.previousStock}
                        </td>
                        <td className="px-pos-xs py-pos-xs text-right font-data text-body-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
                          {m.resultingStock}
                        </td>
                        <td className="px-pos-xs py-pos-xs whitespace-nowrap font-data text-caption tabular-nums" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                          {formatDateTime(m.createdAt)}
                        </td>
                        <td
                          className="max-w-[10rem] truncate px-pos-xs py-pos-xs text-caption"
                          style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}
                          title={m.reason ?? undefined}
                        >
                          {m.reason ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
