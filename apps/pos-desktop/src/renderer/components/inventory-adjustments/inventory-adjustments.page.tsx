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
import { useInventoryAdjustmentsService } from "../common/service-context";
import { useFieldRequirementFor } from "../../../domain/config/use-field-requirement";
import type { FieldRequirement } from "../../../domain/config/types";
import type { DisplayLot, AdjustmentType, AdjustmentReason } from "./inventory-adjustments.types";

import { InventoryAdjustmentsHeader } from "./inventory-adjustments-header";
import { LotSearchPanel } from "./lot-search-panel";
import { AdjustmentForm } from "./adjustment-form";
import { ErrorBanner } from "./error-banner";
import { notify } from "@/utils/notify";

// ── Page component ──────────────────────────────────────────────────────

export const InventoryAdjustmentsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const adjustmentsService = useInventoryAdjustmentsService();
  const reasonRequirement: FieldRequirement = useFieldRequirementFor("inventoryAdjustmentReason");

  // Search / list state
  const [searchQuery, setSearchQuery] = useState("");
  const [allLots, setAllLots] = useState<DisplayLot[]>([]);
  const [filteredLots, setFilteredLots] = useState<DisplayLot[]>([]);
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

    // Session guard — quick check before calling the service.
    // Role enforcement is done by the service's requireRole, which handles
    // supersession (OWNER/SAAS_ADMIN implicitly satisfy ADMIN/INVENTORY_ASSISTANT).
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

      // Map known error codes to localized messages
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
    allLots,
    adjustmentsService,
    t,
  ]);

  // ── Derived ───────────────────────────────────────────────────────────

  const canSubmit = useMemo(
    () => {
      if (!selectedLot || quantity <= 0 || isProcessing) return false;

      // When reason is HIDDEN/OPTIONAL, no reason validation needed
      if (reasonRequirement !== "REQUIRED") return true;

      // When REQUIRED, enforce reason selection
      return reason !== "OTHER" || customReason.trim().length > 0;
    },
    [selectedLot, quantity, isProcessing, reasonRequirement, reason, customReason],
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
              quantityStr={quantityStr}
              onQuantityChange={setQuantityStr}
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
              reasonRequirement={reasonRequirement}
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

    </section>
  );
};
