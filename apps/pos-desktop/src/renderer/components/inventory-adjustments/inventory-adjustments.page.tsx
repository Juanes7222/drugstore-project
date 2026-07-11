/**
 * Inventory Adjustments page — thin wiring container.
 *
 * Owns all form state, validation, and submission orchestration for manual
 * stock corrections.  Presentational sub-components are imported from sibling
 * files so this file stays focused on wiring, not markup.
 *
 * Role is re-checked on submit, not just on mount, to guard against session
 * changes while the form is being filled.
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
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

// ── Presentational components (provided by frontend-pos) ────────────────
import { InventoryAdjustmentsHeader } from "./inventory-adjustments-header";
import { LotSearchPanel } from "./lot-search-panel";
import { AdjustmentForm } from "./adjustment-form";
import { ErrorBanner } from "./error-banner";
import { InventoryAdjustmentsToast } from "./inventory-adjustments-toast";

// ── Constants ───────────────────────────────────────────────────────────

export const ADJUSTMENT_REASONS = [
  "DAMAGED",
  "EXPIRED",
  "LOSS",
  "FOUND",
  "OTHER",
] as const;

// ── Page component ──────────────────────────────────────────────────────

export const InventoryAdjustmentsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const adjustmentsService = useInventoryAdjustmentsService();

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [lots, setLots] = useState<DisplayLot[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedLot, setSelectedLot] = useState<DisplayLot | null>(null);

  // Form
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("DECREASE");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<AdjustmentReason>("OTHER");
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");

  // State
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    operationUuid: string;
    operationType: string;
    isVerified: boolean;
  } | null>(null);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    setError(null);
    setHasSearched(true);
    if (!searchQuery.trim()) {
      setLots([]);
      return;
    }

    try {
      const results = await adjustmentsService.searchLots(searchQuery.trim());
      setLots(results);
    } catch {
      setLots([]);
    }
  }, [searchQuery, adjustmentsService]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        void handleSearch();
      }
    },
    [handleSearch],
  );

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
      setLots((prev) =>
        prev.map((l) =>
          l.id === selectedLot.id
            ? { ...l, currentStock: Math.max(0, l.currentStock + delta) }
            : l,
        ),
      );
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
    adjustmentsService,
    t,
  ]);

  const handleDismissToast = useCallback(() => {
    setToast(null);
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <section
      aria-label={t("inventory_adjustments.title")}
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <InventoryAdjustmentsHeader
        isOnline={isOnline}
        onBack={handleBack}
      />

      <div className="flex-1 px-pos-xl pb-pos-xl">
        <LotSearchPanel
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSearch={handleSearch}
          onKeyDown={handleKeyDown}
          isProcessing={isProcessing}
          hasSearched={hasSearched}
          lots={lots}
          selectedLot={selectedLot}
          onSelectLot={handleSelectLot}
        />

        {selectedLot && (
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

        {error && !selectedLot && <ErrorBanner message={error} />}
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
