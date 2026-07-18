/**
 * AdjustmentForm — card with selected lot info, type toggle, quantity,
 * reason dropdown, custom reason, notes, error banner, and submit button.
 *
 * Adapts to tenant config:
 * - reasonRequirement=HIDDEN → reason field not rendered
 * - reasonRequirement=OPTIONAL → reason shown but not required
 * - reasonRequirement=REQUIRED → reason must be selected to submit
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { DisplayLot, AdjustmentType } from "./inventory-adjustments.types";
import type { FieldRequirement } from "../../../domain/config/types";
import { ErrorBanner } from "./error-banner";
import { MinusIcon, PlusIcon } from "@/components/ui/icons";

interface AdjustmentFormProps {
  selectedLot: DisplayLot;
  adjustmentType: AdjustmentType;
  onAdjustmentTypeChange: (type: AdjustmentType) => void;
  quantityStr: string;
  onQuantityChange: (value: string) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  customReason: string;
  onCustomReasonChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  error: string | null;
  isProcessing: boolean;
  canSubmit: boolean;
  projectedStock: number;
  reasonRequirement: FieldRequirement;
  onSubmit: () => void;
}

const ADJUSTMENT_REASON_KEYS: Record<string, string> = {
  DAMAGED: "inventory_adjustments.reason_damaged",
  EXPIRED: "inventory_adjustments.reason_expired",
  LOSS: "inventory_adjustments.reason_loss",
  FOUND: "inventory_adjustments.reason_found",
  OTHER: "inventory_adjustments.reason_other",
};

export const AdjustmentForm: FC<AdjustmentFormProps> = ({
  selectedLot,
  adjustmentType,
  onAdjustmentTypeChange,
  quantityStr,
  onQuantityChange,
  reason,
  onReasonChange,
  customReason,
  onCustomReasonChange,
  notes,
  onNotesChange,
  error,
  isProcessing,
  canSubmit,
  projectedStock,
  reasonRequirement,
  onSubmit,
}) => {
  const { t } = useTranslation();

  const isDecrease = adjustmentType === "DECREASE";
  const projectedIsNegative = projectedStock <= 0;
  const showReason = reasonRequirement !== "HIDDEN";

  return (
    <section className="pos-panel mt-pos-lg p-pos-md">
      {/* Selected lot heading */}
      <h2
        className="text-ui font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {t("inventory_adjustments.lot_code")}:{" "}
        <span className="font-data tabular-nums">{selectedLot.lotCode}</span>
      </h2>

      {/* Info grid */}
      <div
        className="mt-pos-md grid grid-cols-2 gap-pos-sm text-body-sm"
        style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}
      >
        {/* Current stock */}
        <div>
          <span className="block text-caption font-semibold uppercase tracking-wider">
            {t("inventory_adjustments.stock")}
          </span>
          <span className="font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
            {selectedLot.currentStock}
          </span>
        </div>

        {/* Expiration */}
        <div>
          <span className="block text-caption font-semibold uppercase tracking-wider">
            {t("inventory_adjustments.expires")}
          </span>
          <span className="font-data tabular-nums" style={{ color: "var(--color-ink)" }}>
            {selectedLot.expirationDate}
          </span>
        </div>

        {/* Location */}
        <div>
          <span className="block text-caption font-semibold uppercase tracking-wider">
            {t("inventory_adjustments.location")}
          </span>
          <span style={{ color: "var(--color-ink)" }}>
            {selectedLot.location}
          </span>
        </div>

        {/* Projected stock */}
        <div>
          <span className="block text-caption font-semibold uppercase tracking-wider">
            {t("inventory_adjustments.projected")}
          </span>
          <span
            className="font-data tabular-nums"
            style={{
              color: projectedIsNegative
                ? "var(--color-urgency)"
                : isDecrease
                  ? "var(--color-urgency)"
                  : "var(--color-pharma)",
              fontWeight: "var(--font-weight-semibold)",
            }}
          >
            {projectedStock}
          </span>
        </div>
      </div>

      <hr className="pos-divider my-pos-md" />

      {/* Adjustment type toggle */}
      <fieldset>
        <legend
          className="mb-pos-sm text-body-sm font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          {t("inventory_adjustments.adjustment_type")}
        </legend>
        <div className="flex gap-pos-sm">
          {/* DECREASE */}
          <label
            className={`flex flex-1 cursor-pointer items-center justify-center gap-pos-xs rounded-pos border px-pos-md py-pos-sm text-body-sm font-semibold transition-colors duration-100 ${
              isDecrease
                ? "border-transparent"
                : "border-transparent"
            }`}
            style={{
              backgroundColor: isDecrease
                ? "color-mix(in srgb, var(--color-urgency) 12%, transparent)"
                : "color-mix(in srgb, var(--color-ink) 6%, transparent)",
              color: isDecrease
                ? "var(--color-urgency)"
                : "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            <input
              type="radio"
              name="adjustment-type"
              value="DECREASE"
              checked={isDecrease}
              onChange={() => onAdjustmentTypeChange("DECREASE")}
              className="sr-only"
            />
            <MinusIcon strokeWidth={2.5} />
            {t("inventory_adjustments.decrease")}
          </label>

          {/* INCREASE */}
          <label
            className={`flex flex-1 cursor-pointer items-center justify-center gap-pos-xs rounded-pos border px-pos-md py-pos-sm text-body-sm font-semibold transition-colors duration-100 ${
              !isDecrease
                ? "border-transparent"
                : "border-transparent"
            }`}
            style={{
              backgroundColor: !isDecrease
                ? "color-mix(in srgb, var(--color-pharma) 12%, transparent)"
                : "color-mix(in srgb, var(--color-ink) 6%, transparent)",
              color: !isDecrease
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            <input
              type="radio"
              name="adjustment-type"
              value="INCREASE"
              checked={!isDecrease}
              onChange={() => onAdjustmentTypeChange("INCREASE")}
              className="sr-only"
            />
            <PlusIcon strokeWidth={2.5} />
            {t("inventory_adjustments.increase")}
          </label>
        </div>
      </fieldset>

      {/* Quantity */}
      <div className="mt-pos-md">
        <label
          htmlFor="adjustment-quantity"
          className="mb-pos-xs block text-body-sm font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          {t("inventory_adjustments.quantity")}
        </label>
        <input
          id="adjustment-quantity"
          type="number"
          min={1}
          value={quantityStr}
          onChange={(e) => onQuantityChange(e.target.value)}
          disabled={isProcessing}
          placeholder="1"
          className="pos-input w-32 font-data tabular-nums"
        />
      </div>

      {/* Reason dropdown — hidden when config says OFF */}
      {showReason && (
        <>
          <div className="mt-pos-md">
            <label
              htmlFor="adjustment-reason"
              className="mb-pos-xs block text-body-sm font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("inventory_adjustments.reason")}
              {reasonRequirement === "REQUIRED" && (
                <span className="ml-pos-xs" style={{ color: "var(--color-urgency)" }}>*</span>
              )}
            </label>
            <select
              id="adjustment-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              disabled={isProcessing}
              className="pos-input"
            >
              {Object.entries(ADJUSTMENT_REASON_KEYS).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </div>

          {/* Custom reason (only when OTHER) */}
          {reason === "OTHER" && (
            <div className="mt-pos-md">
              <label
                htmlFor="adjustment-custom-reason"
                className="mb-pos-xs block text-body-sm font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {t("inventory_adjustments.custom_reason")}
              </label>
              <input
                id="adjustment-custom-reason"
                type="text"
                value={customReason}
                onChange={(e) => onCustomReasonChange(e.target.value)}
                disabled={isProcessing}
                className="pos-input"
              />
            </div>
          )}
        </>
      )}

      {/* Notes */}
      <div className="mt-pos-md">
        <label
          htmlFor="adjustment-notes"
          className="mb-pos-xs block text-body-sm font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          {t("inventory_adjustments.notes")}
        </label>
        <textarea
          id="adjustment-notes"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={isProcessing}
          rows={3}
          className="pos-input resize-none"
        />
      </div>

      {/* Error banner */}
      {error && <ErrorBanner message={error} />}

      {/* Submit button */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="pos-button pos-button-primary mt-pos-md w-full py-pos-md text-body-sm"
      >
        {isProcessing ? t("inventory_adjustments.processing") : t("inventory_adjustments.submit")}
      </button>
    </section>
  );
};
