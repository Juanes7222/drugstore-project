/**
 * Inventory Adjustments page — full inventory view with adjustment form.
 *
 * Loads all active lots on mount so the user sees inventory immediately
 * without requiring a search.  Search/filter narrows the shown list.
 * Left panel: scrollable lot list.  Right panel: adjustment form for
 * the selected lot.
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
import { RoleType } from "@pharmacy/shared-types";
import { useInventoryAdjustmentsService } from "../common/service-context";
import type { DisplayLot, AdjustmentType, AdjustmentReason } from "./inventory-adjustments.types";

import { InventoryAdjustmentsHeader } from "./inventory-adjustments-header";
import { LotSearchPanel } from "./lot-search-panel";
import { AdjustmentForm } from "./adjustment-form";
import { ErrorBanner } from "./error-banner";
import { InventoryAdjustmentsToast } from "./inventory-adjustments-toast";

// ── Page component ──────────────────────────────────────────────────────

export const InventoryAdjustmentsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const adjustmentsService = useInventoryAdjustmentsService();

  // Search / list state
  const [searchQuery, setSearchQuery] = useState("");
  const [allLots, setAllLots] = useState<DisplayLot[]>([]);
  const [filteredLots, setFilteredLots] = useState<DisplayLot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLot, setSelectedLot] = useState<DisplayLot | null>(null);

  // Form state
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("DECREASE");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<AdjustmentReason>("OTHER");
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");

  // Processing / error / toast
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    operationUuid: string;
    operationType: string;
    isVerified: boolean;
  } | null>(null);

  // ── Load all lots on mount ────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        const lots = await adjustmentsService.listAllLots();
        if (!cancelled) {
          setAllLots(lots);
          setFilteredLots(lots);
        }
      } catch {
        if (!cancelled) setError(t("inventory_adjustments.load_error"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [adjustmentsService, t]);

  // ── Filter lots when searchQuery changes ──────────────────────────────

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setFilteredLots(allLots);
      return;
    }

    // Filter locally first — faster than a service call
    const filtered = allLots.filter(
      (lot) =>
        lot.productName.toLowerCase().includes(q) ||
        lot.lotCode.toLowerCase().includes(q) ||
        lot.location.toLowerCase().includes(q),
    );

    // If no local match, fall back to service searchLots for DB-fresh results
    if (filtered.length === 0 && searchQuery.trim()) {
      const doSearch = async () => {
        try {
          const results = await adjustmentsService.searchLots(searchQuery.trim());
          setFilteredLots(results);
        } catch {
          setFilteredLots([]);
        }
      };
      void doSearch();
      return;
    }

    setFilteredLots(filtered);
  }, [searchQuery, allLots, adjustmentsService]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSelectLot = useCallback((lot: DisplayLot) => {
    setSelectedLot(lot);
    setError(null);
  }, []);

  const handleBack = useCallback(() => {
    dispatch(navigateBackToSales());
  }, [dispatch]);

  const handleSubmit = useCallback(async () => {
    setError(null);

    // Re-check role at submit time
    const currentSession = useLocalSessionStore.getState().session;
    if (!currentSession) {
      setError(t("errors.no_session"));
      return;
    }
    const role = currentSession.role as RoleType;
    if (role !== RoleType.INVENTORY_ASSISTANT && role !== RoleType.ADMIN) {
      setError(t("errors.role_inventory_admin"));
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
            lotId: selectedLot.id,
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
              lotId: selectedLot.id,
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
      const updatedLots = allLots.map((l) =>
        l.id === selectedLot.id
          ? { ...l, currentStock: Math.max(0, l.currentStock + delta) }
          : l,
      );
      setAllLots(updatedLots);
      setSelectedLot((prev) =>
        prev
          ? { ...prev, currentStock: Math.max(0, prev.currentStock + delta) }
          : null,
      );

      setToast({
        operationUuid:
          (applied as { operationUuid?: string }).operationUuid ??
          (draft as { id: string }).id,
        operationType: "INVENTORY_ADJUSTMENT",
        isVerified: true,
      });

      // Reset form
      setQuantity(1);
      setReason("OTHER");
      setCustomReason("");
      setNotes("");
    } catch (err) {
      setIsProcessing(false);
      setError(
        err instanceof Error ? err.message : t("inventory_adjustments.submit_error"),
      );
    }
  }, [
    selectedLot,
    adjustmentType,
    quantity,
    reason,
    customReason,
    notes,
    allLots,
    adjustmentsService,
    t,
  ]);

  const handleDismissToast = useCallback(() => {
    setToast(null);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────

  const canSubmit = useMemo(
    () =>
      selectedLot !== null &&
      quantity > 0 &&
      !isProcessing &&
      (reason !== "OTHER" || customReason.trim().length > 0),
    [selectedLot, quantity, isProcessing, reason, customReason],
  );

  const adjustmentDelta =
    adjustmentType === "INCREASE" ? quantity : -quantity;
  const projectedStock = selectedLot
    ? Math.max(0, selectedLot.currentStock + adjustmentDelta)
    : 0;

  // ── Render ────────────────────────────────────────────────────────────

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

      {/* ── Two-column body ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-pos-lg px-pos-xl pb-pos-xl">
        {/* Left: scrollable lot list */}
        <div className="flex w-3/5 flex-col overflow-hidden">
          <LotSearchPanel
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            isProcessing={isProcessing || isLoading}
            lots={filteredLots}
            selectedLot={selectedLot}
            onSelectLot={handleSelectLot}
          />
        </div>

        {/* Right: adjustment form (shown when lot selected) */}
        <div className="w-2/5 overflow-y-auto">
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
              quantity={quantity}
              onQuantityChange={(value: number) =>
                setQuantity(Math.max(1, value))
              }
              reason={reason}
              onReasonChange={(reason: string) => setReason(reason as AdjustmentReason)}
              customReason={customReason}
              onCustomReasonChange={setCustomReason}
              notes={notes}
              onNotesChange={setNotes}
              error={error}
              isProcessing={isProcessing}
              canSubmit={canSubmit}
              projectedStock={projectedStock}
              onSubmit={handleSubmit}
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

      {toast && (
        <InventoryAdjustmentsToast
          operationUuid={toast.operationUuid}
          operationType={toast.operationType}
          isVerified={toast.isVerified}
          isOnline={isOnline}
          onDismiss={handleDismissToast}
        />
      )}
    </section>
  );
};
