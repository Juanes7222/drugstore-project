/**
 * Inventory Adjustments page — full inventory view with adjustment form.
 *
 * Two modes:
 * - **Lot tracking ON** (`requireLotOnReception=true`): shows lots grouped by product
 *   in LotSearchPanel. User selects a specific lot to adjust.
 * - **Lot tracking OFF** (`requireLotOnReception=false`): shows a flat product list.
 *   User selects a product; the adjustment auto-resolves to the oldest lot (FEFO).
 *   No lot details are visible to the user.
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { navigateBackToSales } from "@/store/slices/ui-slice";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  useInventoryAdjustmentsService,
  useInventoryLotsService,
} from "../common/service-context";
import { useFieldRequirementFor } from "../../../domain/config/use-field-requirement";
import { useRequireLotOnReception } from "../../../domain/configuration";
import type { FieldRequirement } from "../../../domain/config/types";
import type { ProductLotGroup } from "../../../domain/inventory-lots/inventory-lots.service";
import type { DisplayLot, AdjustmentType, AdjustmentReason } from "./inventory-adjustments.types";

import { InventoryAdjustmentsHeader } from "./inventory-adjustments-header";
import { LotSearchPanel } from "./lot-search-panel";
import { AdjustmentForm } from "./adjustment-form";
import { ErrorBanner } from "./error-banner";
import { notify } from "@/utils/notify";
import { SearchIcon } from "@/components/ui/icons";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOW_STOCK_THRESHOLD = 10;

function toDisplayLot(
  productId: string,
  productName: string,
  lotId: string,
  lotCode: string,
  currentStock: number,
  expirationDate: Date,
  location: string,
): DisplayLot {
  return {
    id: lotId,
    productId,
    productName,
    lotCode,
    currentStock,
    expirationDate: expirationDate.toISOString(),
    location,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const InventoryAdjustmentsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const adjustmentsService = useInventoryAdjustmentsService();
  const inventoryLotsService = useInventoryLotsService();
  const reasonRequirement: FieldRequirement = useFieldRequirementFor("inventoryAdjustmentReason");
  const requireLotOnReception = useRequireLotOnReception();
  const lotManagementOff = !requireLotOnReception;

  // Search / list state
  const [searchQuery, setSearchQuery] = useState("");
  const [productGroups, setProductGroups] = useState<ProductLotGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLot, setSelectedLot] = useState<DisplayLot | null>(null);

  // Form state
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("DECREASE");
  const [quantityStr, setQuantityStr] = useState("1");
  const [reason, setReason] = useState<AdjustmentReason>("OTHER");
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");

  // Derived numeric quantity from input string
  const quantity = Number(quantityStr) || 0;

  // Processing / error
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load data on mount ───────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        const groups = await inventoryLotsService.getLotsGroupedByProduct();
        if (!cancelled) {
          setProductGroups(groups);
        }
      } catch {
        if (!cancelled) setError(t("inventory_adjustments.load_error"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [inventoryLotsService, t]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleSelectLot = useCallback((lot: DisplayLot) => {
    setSelectedLot(lot);
    setError(null);
  }, []);

  /**
   * In no-lot mode: when a product group is clicked, create a synthetic
   * DisplayLot with the total stock of the product (not a single lot).
   */
  const handleSelectProductGroup = useCallback((group: ProductLotGroup) => {
    const oldestActive = group.lots
      .filter((l) => l.currentStock > 0)
      .sort(
        (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime(),
      )[0];

    if (oldestActive) {
      setSelectedLot(
        toDisplayLot(
          group.productId,
          group.commercialName,
          oldestActive.id,
          oldestActive.batchNumber,
          group.totalStock,     // ← total stock, not lot-level stock
          oldestActive.expirationDate,
          oldestActive.locationCode ?? "",
        ),
      );
    }
    setError(null);
  }, []);

  const handleBack = useCallback(() => {
    dispatch(navigateBackToSales());
  }, [dispatch]);

  const handleSubmit = useCallback(async () => {
    setError(null);

    // Session guard
    const currentSession = useLocalSessionStore.getState().session;
    if (!currentSession) {
      setError(t("errors.no_session"));
      return;
    }

    if (!selectedLot) {
      setError(t("inventory_adjustments.no_lot_selected"));
      return;
    }

    if (quantity <= 0) {
      setError(t("inventory_adjustments.quantity_invalid"));
      return;
    }

    // In no-lot mode, re-resolve the oldest lot in case stock changed
    // since the product was selected.
    let targetLotId = selectedLot.id;
    if (lotManagementOff) {
      const lots = await inventoryLotsService.getLots({
        productId: selectedLot.productId,
        state: 'ACTIVE',
      });
      const oldestActive = lots
        .filter((l) => l.currentStock > 0)
        .sort(
          (a, b) =>
            a.expirationDate.getTime() - b.expirationDate.getTime(),
        )[0];
      if (!oldestActive) {
        setError(t("inventory_adjustments.no_inventory"));
        return;
      }
      targetLotId = oldestActive.id;
    }

    const effectiveReason =
      reason === "OTHER" && customReason.trim()
        ? customReason.trim()
        : reason;

    try {
      setIsProcessing(true);

      const signedQuantity =
        adjustmentType === "INCREASE" ? quantity : -quantity;

      const draft = await adjustmentsService.create({
        items: [
          {
            productId: selectedLot.productId,
            quantity: signedQuantity,
            lotId: targetLotId,
            reason: effectiveReason,
          },
        ],
        notes,
        reason: effectiveReason,
      });

      const applied = await adjustmentsService.apply(
        (draft as { id: string }).id,
        {
          items: [
            {
              productId: selectedLot.productId,
              quantity: signedQuantity,
              lotId: targetLotId,
              reason: effectiveReason,
            },
          ],
          notes,
          reason: effectiveReason,
        },
      );

      setIsProcessing(false);

      // Optimistic local stock update
      const delta = adjustmentType === "INCREASE" ? quantity : -quantity;
      setProductGroups((prev) =>
        prev.map((group) => ({
          ...group,
          totalStock:
            group.productId === selectedLot.productId
              ? group.totalStock + delta
              : group.totalStock,
          lots: group.lots.map((lot) =>
            lot.id === targetLotId
              ? { ...lot, currentStock: Math.max(0, lot.currentStock + delta) }
              : lot,
          ),
        })),
      );
      setSelectedLot((prev) =>
        prev
          ? { ...prev, currentStock: Math.max(0, prev.currentStock + delta) }
          : null,
      );

      // Notify via sileo toast
      const operationUuid =
        (applied as { operationUuid?: string }).operationUuid ??
        (draft as { id: string }).id;
      const truncatedUuid =
        operationUuid.length > 8
          ? `${operationUuid.slice(0, 8)}...`
          : operationUuid;
      notify.success({
        title: isOnline
          ? t("toast.status_synced")
          : t("toast.status_queued"),
        description: `${t("toast.operation_type.INVENTORY_ADJUSTMENT")} — ${truncatedUuid}`,
      });

      // Reset form
      setQuantityStr("1");
      setReason("OTHER");
      setCustomReason("");
      setNotes("");
    } catch (err) {
      setIsProcessing(false);
      if (
        err &&
        typeof err === "object" &&
        "errorCode" in err &&
        (err as { errorCode: string }).errorCode === "INSUFFICIENT_ROLE"
      ) {
        setError(t("errors.role_inventory_admin"));
      } else {
        setError(
          err instanceof Error ? err.message : t("inventory_adjustments.submit_error"),
        );
      }
    }
  }, [
    selectedLot,
    adjustmentType,
    quantity,
    reason,
    customReason,
    notes,
    productGroups,
    adjustmentsService,
    inventoryLotsService,
    lotManagementOff,
    isOnline,
    t,
  ]);

  // ── Derived ──────────────────────────────────────────────────────────

  const canSubmit = useMemo(
    () => {
      if (!selectedLot || quantity <= 0 || isProcessing) return false;
      if (reasonRequirement !== "REQUIRED") return true;
      return reason !== "OTHER" || customReason.trim().length > 0;
    },
    [selectedLot, quantity, isProcessing, reasonRequirement, reason, customReason],
  );

  const adjustmentDelta =
    adjustmentType === "INCREASE" ? quantity : -quantity;
  const projectedStock = selectedLot
    ? Math.max(0, selectedLot.currentStock + adjustmentDelta)
    : 0;

  // ── Filter product groups for no-lot mode ────────────────────────────

  const filteredProductGroups = useMemo(() => {
    if (!lotManagementOff) return productGroups;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return productGroups;
    return productGroups.filter(
      (g) =>
        g.commercialName.toLowerCase().includes(q) ||
        g.internalCode.toLowerCase().includes(q),
    );
  }, [productGroups, searchQuery, lotManagementOff]);

  const hasResults = filteredProductGroups.length > 0;

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <section
      aria-label={t("inventory_adjustments.title")}
      className="flex h-full flex-col"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <InventoryAdjustmentsHeader
        isOnline={isOnline}
        onBack={handleBack}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-pos-lg px-pos-xl pb-pos-xl lg:flex-row">
        {/* ── Left panel ──────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {lotManagementOff ? (
            /* ── No-lot mode: flat product list ─────────────────────── */
            <section
              className="flex flex-col overflow-hidden"
              aria-label={t("inventory_adjustments.inventory_list")}
            >
              {/* Search bar */}
              <div className="mb-pos-sm flex items-center gap-pos-sm">
                <div className="relative flex-1">
                  <input
                    id="product-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("inventory_adjustments.search_placeholder")}
                    disabled={isProcessing}
                    className="pos-input w-full pl-pos-lg"
                  />
                  <span
                    className="absolute left-pos-sm top-1/2 -translate-y-1/2"
                    style={{
                      color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                    }}
                  >
                    <SearchIcon />
                  </span>
                </div>
                <span
                  className="shrink-0 rounded-full px-pos-sm py-pos-xs font-data text-caption tabular-nums"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
                    color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
                  }}
                >
                  {filteredProductGroups.length}
                </span>
              </div>

              {/* Scrollable product list */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {isLoading && (
                  <div className="flex items-center justify-center py-pos-xl">
                    <p className="text-body-sm" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}>
                      {t("common.loading")}
                    </p>
                  </div>
                )}

                {!isLoading && !hasResults && (
                  <div className="flex items-center justify-center py-pos-xl">
                    <p className="text-body-sm" style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }}>
                      {searchQuery.trim()
                        ? t("inventory_adjustments.no_results")
                        : t("inventory_adjustments.no_inventory")}
                    </p>
                  </div>
                )}

                {!isLoading &&
                  filteredProductGroups.map((group) => {
                    const isSelected = selectedLot?.productId === group.productId;
                    const alerts: string[] = [];
                    if (group.expiredCount > 0) alerts.push(`${group.expiredCount} ${t("inventory_adjustments.badge_expired")}`);
                    if (group.soonToExpireCount > 0) alerts.push(`${group.soonToExpireCount} ${t("inventory_adjustments.badge_near_expiry")}`);
                    // In no-lot mode, low stock is based on total product stock,
                    // not per-lot count.
                    if (group.totalStock <= LOW_STOCK_THRESHOLD) alerts.push(t("inventory_adjustments.badge_low_stock"));

                    return (
                      <div
                        key={group.productId}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={0}
                        onClick={() => handleSelectProductGroup(group)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectProductGroup(group);
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
                            {group.commercialName}
                          </p>
                          <span
                            className="shrink-0 ml-auto font-data text-caption tabular-nums"
                            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
                          >
                            {t("inventory_adjustments.stock")}: {group.totalStock}
                          </span>
                        </div>

                        {/* Internal code */}
                        <p
                          className="mt-pos-xs text-caption truncate"
                          style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
                        >
                          {group.internalCode}
                        </p>

                        {/* Alert badges */}
                        {alerts.length > 0 && (
                          <div className="mt-pos-xs flex flex-wrap gap-pos-xs">
                            {alerts.map((a) => (
                              <span
                                key={a}
                                className="rounded px-pos-xs py-0.5 text-caption font-semibold"
                                style={{
                                  backgroundColor: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
                                  color: "var(--color-warning)",
                                }}
                              >
                                {a}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>
          ) : (
            /* ── Lot mode: grouped lot list ────────────────────────── */
            <LotSearchPanel
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              isProcessing={isProcessing || isLoading}
              productGroups={productGroups}
              selectedLot={selectedLot}
              onSelectLot={handleSelectLot}
            />
          )}
        </div>

        {/* ── Right panel: adjustment form ────────────────────────────── */}
        <div className="h-1/2 min-h-0 w-full shrink-0 overflow-y-auto lg:h-auto lg:w-2/5">
          {isLoading && (
            <div className="pos-panel flex items-center justify-center p-pos-xl">
              <p
                className="text-body-sm"
                style={{
                  color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {t("common.loading")}
              </p>
            </div>
          )}

          {!isLoading && selectedLot && (
            <AdjustmentForm
              selectedLot={selectedLot}
              adjustmentType={adjustmentType}
              onAdjustmentTypeChange={setAdjustmentType}
              quantityStr={quantityStr}
              onQuantityChange={setQuantityStr}
              reason={reason}
              onReasonChange={(r: string) => setReason(r as AdjustmentReason)}
              customReason={customReason}
              onCustomReasonChange={setCustomReason}
              notes={notes}
              onNotesChange={setNotes}
              error={error}
              isProcessing={isProcessing}
              canSubmit={canSubmit}
              projectedStock={projectedStock}
              reasonRequirement={reasonRequirement}
              onSubmit={handleSubmit}
              showLotInfo={!lotManagementOff}
            />
          )}

          {!isLoading && !selectedLot && (
            <div className="pos-panel flex items-center justify-center p-pos-xl">
              <p
                className="text-body-sm text-center"
                style={{
                  color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                }}
              >
                {t("inventory_adjustments.select_lot_hint")}
              </p>
            </div>
          )}

          {error && !selectedLot && (
            <div className="mt-pos-md">
              <ErrorBanner message={error} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
