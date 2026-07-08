/**
 * InventoryAdjustmentsPage — manual stock correction screen.
 *
 * Allows INVENTORY_ASSISTANT and ADMIN roles to create positive (INCREASE)
 * or negative (DECREASE) stock adjustments against specific lots.
 *
 * The product/lot search is populated from local state (eventually from the
 * local Prisma Lot table), while the submit action uses the real
 * InventoryAdjustmentsService from modules/ which validates and applies
 * the adjustment against the authoritative local database.
 *
 * Role is re-checked on submit, not just on mount, to guard against session
 * changes while the form is being filled.
 */
import {
  type FC,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { navigateBackToSales } from "@/store/slices/ui-slice";
import { useLocalSessionStore } from "../auth/local-session.store";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { OperationQueuedToast } from "@/components/common/operation-queued-toast";
import { RoleType } from "@pharmacy/shared-types";
import { useInventoryAdjustmentsService } from "../../infrastructure/service-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdjustmentType = "INCREASE" | "DECREASE";

interface DisplayLot {
  id: string;
  productId: string;
  productName: string;
  lotCode: string;
  currentStock: number;
  expirationDate: string;
  location: string;
}

const ADJUSTMENT_REASONS = [
  "DAMAGED",
  "EXPIRED",
  "LOSS",
  "FOUND",
  "OTHER",
] as const;

type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

// ---------------------------------------------------------------------------
// Demo data — local product/lot cache
//
// TODO: Replace with a real query against the local Prisma Lot + Product
//       tables once the service layer exposes a product-lot search method
//       or the PrismaClient is exposed to the renderer.
// ---------------------------------------------------------------------------

const DEMO_LOTS: DisplayLot[] = [
  {
    id: "lot-001",
    productId: "prod-001",
    productName: "Amoxicilina 500mg",
    lotCode: "LOT-AMX-001",
    currentStock: 120,
    expirationDate: "2027-03-15",
    location: "Estante A-12",
  },
  {
    id: "lot-002",
    productId: "prod-002",
    productName: "Ibuprofeno 400mg",
    lotCode: "LOT-IBU-001",
    currentStock: 85,
    expirationDate: "2026-11-20",
    location: "Estante B-04",
  },
  {
    id: "lot-003",
    productId: "prod-003",
    productName: "Losartán 50mg",
    lotCode: "LOT-LOS-001",
    currentStock: 45,
    expirationDate: "2026-09-01",
    location: "Estante C-08",
  },
  {
    id: "lot-004",
    productId: "prod-001",
    productName: "Amoxicilina 500mg",
    lotCode: "LOT-AMX-002",
    currentStock: 60,
    expirationDate: "2027-06-10",
    location: "Estante A-12",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const InventoryAdjustmentsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const adjustmentsService = useInventoryAdjustmentsService();

  // Search — will eventually query Prisma; currently filters DEMO_LOTS
  const [searchQuery, setSearchQuery] = useState("");
  const [lots, setLots] = useState<DisplayLot[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedLot, setSelectedLot] = useState<DisplayLot | null>(null);

  // In-memory mutable copy so the UI reflects post-adjustment stock immediately
  const lotsRef = useRef<DisplayLot[]>(DEMO_LOTS.map((l) => ({ ...l })));

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

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleSearch = useCallback(async () => {
    setError(null);
    setHasSearched(true);
    if (!searchQuery.trim()) {
      setLots([]);
      return;
    }

    const q = searchQuery.toLowerCase();
    const results = lotsRef.current.filter(
      (lot) =>
        lot.productName.toLowerCase().includes(q) ||
        lot.lotCode.toLowerCase().includes(q),
    );
    setLots(results);
  }, [searchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
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

    const effectiveReason = reason === "OTHER" && customReason.trim()
      ? customReason.trim()
      : reason;

    try {
      setIsProcessing(true);

      // Build the signed quantity (positive = INCREASE, negative = DECREASE)
      const signedQuantity =
        adjustmentType === "INCREASE" ? quantity : -quantity;

      // Call the real InventoryAdjustmentsService
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

      // Apply the adjustment (stock change + SyncQueue entry)
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

      // Update local display to reflect the new stock
      const delta = adjustmentType === "INCREASE" ? quantity : -quantity;
      const lotInRef = lotsRef.current.find((l) => l.id === selectedLot.id);
      if (lotInRef) {
        lotInRef.currentStock = Math.max(0, lotInRef.currentStock + delta);
      }
      setSelectedLot((prev) =>
        prev
          ? { ...prev, currentStock: Math.max(0, prev.currentStock + delta) }
          : null,
      );

      setToast({
        operationUuid: (applied as { operationUuid?: string }).operationUuid
          ?? (draft as { id: string }).id,
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

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <section
      aria-label={t("inventory_adjustments.title")}
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-pos-xl pt-pos-lg pb-pos-md">
        <div className="flex items-center gap-pos-md">
          <button
            type="button"
            onClick={handleBack}
            className="pos-button pos-button-secondary"
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>
          <h1
            className="pos-page-title"
            style={{ color: "var(--color-ink)" }}
          >
            {t("inventory_adjustments.title")}
          </h1>
        </div>
        <span
          className="text-caption font-medium"
          style={{
            color: isOnline
              ? "var(--color-pharma)"
              : "var(--color-urgency)",
          }}
        >
          {isOnline ? t("sync.state_online") : t("sync.state_offline")}
        </span>
      </div>

      <div className="flex-1 px-pos-xl pb-pos-xl">
        {/* Product / lot search */}
        <div className="pos-panel p-pos-md mb-pos-lg">
          <label
            htmlFor="adj-product-search"
            className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("inventory_adjustments.search_label")}
          </label>
          <div className="flex gap-pos-sm">
            <input
              id="adj-product-search"
              type="text"
              className="pos-input"
              placeholder={t("inventory_adjustments.search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isProcessing}
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={isProcessing || !searchQuery.trim()}
              className="pos-button pos-button-primary"
            >
              {t("common.search")}
            </button>
          </div>

          {/* Search results */}
          {hasSearched && lots.length === 0 && (
            <p
              className="mt-pos-sm text-caption"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              }}
            >
              {t("inventory_adjustments.no_results")}
            </p>
          )}

          {lots.length > 0 && (
            <ul className="mt-pos-md flex flex-col gap-pos-xs">
              {lots.map((lot) => {
                const isSelected = selectedLot?.id === lot.id;
                return (
                  <li key={lot.id}>
                    <button
                      type="button"
                      className={`w-full rounded px-pos-sm py-pos-xs text-left transition-colors ${
                        isSelected
                          ? ""
                          : "hover:bg-[color-mix(in_srgb,var(--color-surface)_50%,white)]"
                      }`}
                      style={
                        isSelected
                          ? {
                              backgroundColor:
                                "color-mix(in srgb, var(--color-pharma) 10%, white)",
                              borderLeft: "3px solid var(--color-pharma)",
                            }
                          : {
                              borderLeft:
                                "3px solid transparent",
                            }
                      }
                      onClick={() => handleSelectLot(lot)}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="text-body font-medium"
                          style={{ color: "var(--color-ink)" }}
                        >
                          {lot.productName}
                        </span>
                        <span className="font-data tabular-nums text-body-sm">
                          {t("inventory_adjustments.lot_code")}: {lot.lotCode}
                        </span>
                      </div>
                      <div
                        className="mt-pos-xs text-caption"
                        style={{
                          color:
                            "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                        }}
                      >
                        {t("inventory_adjustments.stock")}:{" "}
                        <span
                          className={`font-data tabular-nums ${
                            lot.currentStock <= 10
                              ? "font-semibold"
                              : ""
                          }`}
                          style={
                            lot.currentStock <= 10
                              ? { color: "var(--color-urgency)" }
                              : undefined
                          }
                        >
                          {lot.currentStock}
                        </span>
                        {" | "}
                        {t("inventory_adjustments.expires")}: {lot.expirationDate}
                        {" | "}
                        {lot.location}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Selected lot details + adjustment form */}
        {selectedLot && (
          <div className="pos-panel p-pos-md mb-pos-lg">
            <h2
              className="text-ui font-semibold mb-pos-sm"
              style={{ color: "var(--color-ink)" }}
            >
              {t("inventory_adjustments.selected_lot")}: {selectedLot.lotCode}
            </h2>

            <div className="grid grid-cols-4 gap-pos-md mb-pos-lg">
              <div>
                <span
                  className="text-caption font-semibold uppercase tracking-wide"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("inventory_adjustments.stock")}
                </span>
                <p className="font-data tabular-nums text-price font-bold">
                  {selectedLot.currentStock}
                </p>
              </div>
              <div>
                <span
                  className="text-caption font-semibold uppercase tracking-wide"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("inventory_adjustments.expires")}
                </span>
                <p className="text-body font-medium">
                  {selectedLot.expirationDate}
                </p>
              </div>
              <div>
                <span
                  className="text-caption font-semibold uppercase tracking-wide"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("inventory_adjustments.location")}
                </span>
                <p className="text-body">{selectedLot.location}</p>
              </div>
              <div>
                <span
                  className="text-caption font-semibold uppercase tracking-wide"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("inventory_adjustments.projected")}
                </span>
                <p
                  className={`font-data tabular-nums text-price font-bold`}
                  style={{
                    color:
                      projectedStock < 0
                        ? "var(--color-urgency)"
                        : "var(--color-pharma)",
                  }}
                >
                  {projectedStock}
                </p>
              </div>
            </div>

            {/* Type toggle */}
            <div
              className="mb-pos-md flex gap-pos-xs"
              role="radiogroup"
              aria-label={t("inventory_adjustments.adjustment_type")}
            >
              <button
                type="button"
                role="radio"
                aria-checked={adjustmentType === "DECREASE"}
                className={`pos-button flex-1 ${
                  adjustmentType === "DECREASE"
                    ? "pos-button-restrict"
                    : "pos-button-secondary"
                }`}
                onClick={() => setAdjustmentType("DECREASE")}
              >
                {t("inventory_adjustments.decrease")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={adjustmentType === "INCREASE"}
                className={`pos-button flex-1 ${
                  adjustmentType === "INCREASE"
                    ? "pos-button-primary"
                    : "pos-button-secondary"
                }`}
                onClick={() => setAdjustmentType("INCREASE")}
              >
                {t("inventory_adjustments.increase")}
              </button>
            </div>

            {/* Quantity */}
            <div className="mb-pos-md">
              <label
                htmlFor="adj-quantity"
                className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("inventory_adjustments.quantity")}
              </label>
              <input
                id="adj-quantity"
                type="number"
                className="pos-input"
                min={1}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, Number(e.target.value)))
                }
                disabled={isProcessing}
              />
            </div>

            {/* Reason dropdown */}
            <div className="mb-pos-md">
              <label
                htmlFor="adj-reason"
                className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("inventory_adjustments.reason")}
              </label>
              <select
                id="adj-reason"
                className="pos-input"
                value={reason}
                onChange={(e) =>
                  setReason(e.target.value as AdjustmentReason)
                }
                disabled={isProcessing}
              >
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`inventory_adjustments.reason_${r.toLowerCase()}`, {
                      defaultValue: r,
                    })}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom reason (when OTHER is selected) */}
            {reason === "OTHER" && (
              <div className="mb-pos-md">
                <label
                  htmlFor="adj-custom-reason"
                  className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("inventory_adjustments.custom_reason")}
                </label>
                <input
                  id="adj-custom-reason"
                  type="text"
                  className="pos-input"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  disabled={isProcessing}
                  maxLength={200}
                />
              </div>
            )}

            {/* Notes */}
            <div className="mb-pos-md">
              <label
                htmlFor="adj-notes"
                className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("inventory_adjustments.notes")}
              </label>
              <textarea
                id="adj-notes"
                className="pos-input min-h-[64px] resize-y"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isProcessing}
                maxLength={500}
              />
            </div>

            {/* Submit error */}
            {error && (
              <div
                className="mb-pos-md rounded px-pos-md py-pos-sm text-body font-medium"
                role="alert"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
                  color: "var(--color-urgency)",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="pos-button pos-button-primary px-pos-xl w-full"
            >
              {isProcessing
                ? t("inventory_adjustments.processing")
                : t("inventory_adjustments.submit")}
            </button>
          </div>
        )}

        {/* Generic error when no lot selected */}
        {error && !selectedLot && (
          <div
            className="rounded px-pos-md py-pos-sm text-body font-medium"
            role="alert"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
              color: "var(--color-urgency)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <OperationQueuedToast
            operationUuid={toast.operationUuid}
            operationType={toast.operationType}
            isVerified={toast.isVerified}
            isOnline={isOnline}
            onDismiss={handleDismissToast}
          />
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

const BackIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);
