/**
 * LotMovementHistory — expandable panel showing inventory movements for a lot.
 *
 * Fetches movements from the lots service when expanded and renders a compact
 * timeline-style table: movement type, quantity delta, stock before/after,
 * timestamp, reason, and who performed it.
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
import type { LotMovementRecord } from "../../../domain/inventory-lots/inventory-lots.service";
import { useInventoryLotsService } from "../common/service-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  SALE: "inventory_lots.movement_sale",
  POSITIVE_ADJUSTMENT: "inventory_lots.movement_positive_adjustment",
  NEGATIVE_ADJUSTMENT: "inventory_lots.movement_negative_adjustment",
};

const MOVEMENT_TYPE_COLOR: Record<string, string> = {
  SALE: "var(--color-ink)",
  POSITIVE_ADJUSTMENT: "var(--color-pharma)",
  NEGATIVE_ADJUSTMENT: "var(--color-urgency)",
};

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LotMovementHistoryProps {
  lotId: string;
  lotCode: string;
  isOpen: boolean;
  onClose: () => void;
}

export const LotMovementHistory: FC<LotMovementHistoryProps> = ({
  lotId,
  lotCode,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const lotsService = useInventoryLotsService();

  const [movements, setMovements] = useState<LotMovementRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch movements when panel opens
  const loadMovements = useCallback(async () => {
    if (!isOpen) return;
    setIsLoading(true);
    setError(null);
    try {
      const records = await lotsService.getMovementsForLot(lotId);
      setMovements(records);
    } catch {
      setError(t("inventory_lots.movements_load_error"));
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, lotId, lotsService, t]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  if (!isOpen) return null;

  return (
    <tr>
      <td colSpan={7} className="p-0">
        <div
          className="border-t"
          style={{
            borderColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--color-ink) 2%, transparent)",
          }}
        >
          <div className="px-pos-sm py-pos-xs">
            {/* Header row */}
            <div className="flex items-center justify-between mb-pos-xs">
              <span className="text-caption font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-muted)" }}>
                {t("inventory_lots.movement_history_title", { lotCode })}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="text-caption outline-none"
                style={{ color: "var(--color-ink-muted)" }}
                aria-label={t("common.close")}
              >
                ✕
              </button>
            </div>

            {/* Loading state */}
            {isLoading && (
              <p className="text-caption py-pos-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("common.loading")}
              </p>
            )}

            {/* Error state */}
            {error && (
              <p className="text-caption py-pos-xs" style={{ color: "var(--color-urgency)" }}>
                {error}
              </p>
            )}

            {/* Empty state */}
            {!isLoading && !error && movements.length === 0 && (
              <p className="text-caption py-pos-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("inventory_lots.no_movements")}
              </p>
            )}

            {/* Movement list */}
            {!isLoading && movements.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full border-collapse text-caption">
                  <thead>
                    <tr style={{ color: "var(--color-ink-muted)" }}>
                      <th className="pr-pos-xs py-0.5 text-left font-medium">{t("inventory_lots.movement_type")}</th>
                      <th className="px-pos-xs py-0.5 text-right font-medium">{t("inventory_lots.movement_qty")}</th>
                      <th className="px-pos-xs py-0.5 text-right font-medium">{t("inventory_lots.movement_stock_before")}</th>
                      <th className="px-pos-xs py-0.5 text-right font-medium">{t("inventory_lots.movement_stock_after")}</th>
                      <th className="px-pos-xs py-0.5 text-left font-medium">{t("inventory_lots.movement_date")}</th>
                      <th className="px-pos-xs py-0.5 text-left font-medium">{t("inventory_lots.movement_by")}</th>
                      <th className="pl-pos-xs py-0.5 text-left font-medium">{t("inventory_lots.movement_reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr
                        key={m.id}
                        style={{
                          borderTop: "1px solid color-mix(in srgb, var(--color-ink) 4%, transparent)",
                        }}
                      >
                        <td className="pr-pos-xs py-0.5">
                          <span
                            className="font-medium"
                            style={{ color: MOVEMENT_TYPE_COLOR[m.movementType] ?? "var(--color-ink)" }}
                          >
                            {t(
                              MOVEMENT_TYPE_LABEL[m.movementType] ?? m.movementType,
                              m.movementType,
                            )}
                          </span>
                        </td>
                        <td
                          className="px-pos-xs py-0.5 text-right font-data tabular-nums"
                          style={{
                            color: m.quantity > 0 ? "var(--color-pharma)" : "var(--color-urgency)",
                            fontWeight: 600,
                          }}
                        >
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="px-pos-xs py-0.5 text-right font-data tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                          {m.previousStock}
                        </td>
                        <td className="px-pos-xs py-0.5 text-right font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
                          {m.resultingStock}
                        </td>
                        <td className="px-pos-xs py-0.5 whitespace-nowrap font-data tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                          {formatDateTime(m.createdAt)}
                        </td>
                        <td className="px-pos-xs py-0.5" style={{ color: "var(--color-ink-muted)" }}>
                          {m.createdByName ?? "—"}
                        </td>
                        <td className="pl-pos-xs py-0.5" style={{ color: "var(--color-ink-muted)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.reason ?? ""}>
                          {m.reason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
};
