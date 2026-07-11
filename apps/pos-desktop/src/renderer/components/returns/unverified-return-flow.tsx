/**
 * UnverifiedReturnFlow — manual item entry, manager PIN confirmation,
 * and unverified return submission.
 *
 * Used when the sale is not found locally (e.g. from a different
 * workstation that hasn't synced yet). Requires an ADMIN role and a
 * manager PIN override. Uses the restrict-violet accent to visually
 * distinguish this flow's higher regulatory weight.
 *
 * @category Component
 */

import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UnverifiedItemEntry } from "./returns.types";

interface UnverifiedReturnFlowProps {
  /** Current list of manually entered items. */
  items: UnverifiedItemEntry[];
  /** Called when the items list changes (add/remove). */
  onItemsChange: (items: UnverifiedItemEntry[]) => void;
  /** Current manager PIN input value. */
  managerPin: string;
  /** Called when the PIN input changes. */
  onManagerPinChange: (pin: string) => void;
  /** Error message for the PIN field, or null. */
  pinError: string | null;
  /** Whether the submission is in progress. */
  isProcessing: boolean;
  /** Called to submit the unverified return. */
  onSubmit: () => void;
  /** Whether the submit button should be enabled. */
  canSubmit: boolean;
}

export const UnverifiedReturnFlow: FC<UnverifiedReturnFlowProps> = ({
  items,
  onItemsChange,
  managerPin,
  onManagerPinChange,
  pinError,
  isProcessing,
  onSubmit,
  canSubmit,
}) => {
  const { t } = useTranslation();

  // Local entry form state — cleared after "Add"
  const [productName, setProductName] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [quantity, setQuantity] = useState(1);

  const handleAddItem = useCallback(() => {
    const trimmedName = productName.trim();
    const trimmedLot = lotCode.trim();

    if (!trimmedName || !trimmedLot || quantity < 1) {
      return;
    }

    const newItem: UnverifiedItemEntry = {
      productId: `manual-${trimmedName}-${Date.now()}`,
      productName: trimmedName,
      lotCode: trimmedLot,
      quantity,
    };

    onItemsChange([...items, newItem]);
    setProductName("");
    setLotCode("");
    setQuantity(1);
  }, [productName, lotCode, quantity, items, onItemsChange]);

  const handleRemoveItem = useCallback(
    (itemIndex: number) => {
      const next = items.filter((_, i) => i !== itemIndex);
      onItemsChange(next);
    },
    [items, onItemsChange],
  );

  const handleQuantityKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddItem();
      }
    },
    [handleAddItem],
  );

  return (
    <div className="flex flex-col gap-pos-xl">
      {/* ── Notice Card ── */}
      <div
        className="rounded-pos p-pos-lg"
        style={{
          backgroundColor: "var(--color-restrict-surface)",
          borderLeft: "4px solid var(--color-restrict)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-restrict)",
            margin: 0,
          }}
        >
          {t("returns.unverified_notice")}
        </p>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-body-sm)",
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            margin: "var(--spacing-pos-xs) 0 0",
          }}
        >
          {t("returns.unverified_description")}
        </p>
      </div>

      {/* ── Product / Lot Entry Grid ── */}
      <div className="pos-panel p-pos-lg">
        <div
          className="grid gap-pos-md"
          style={{
            gridTemplateColumns: "1fr 1fr 80px auto",
            alignItems: "end",
          }}
        >
          {/* Product name */}
          <div>
            <label
              htmlFor="unverified-product"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                display: "block",
                marginBottom: "var(--spacing-pos-xs)",
              }}
            >
              {t("returns.unverified_product")}
            </label>
            <input
              id="unverified-product"
              type="text"
              className="pos-input"
              placeholder={t("returns.unverified_product_placeholder")}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              disabled={isProcessing}
              autoComplete="off"
            />
          </div>

          {/* Lot code */}
          <div>
            <label
              htmlFor="unverified-lot"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                display: "block",
                marginBottom: "var(--spacing-pos-xs)",
              }}
            >
              {t("returns.unverified_lot")}
            </label>
            <input
              id="unverified-lot"
              type="text"
              className="pos-input font-data"
              placeholder={t("returns.unverified_lot_placeholder")}
              value={lotCode}
              onChange={(e) => setLotCode(e.target.value)}
              disabled={isProcessing}
              autoComplete="off"
            />
          </div>

          {/* Quantity */}
          <div>
            <label
              htmlFor="unverified-qty"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                display: "block",
                marginBottom: "var(--spacing-pos-xs)",
              }}
            >
              {t("returns.table_qty")}
            </label>
            <input
              id="unverified-qty"
              type="number"
              className="pos-input font-data tabular-nums"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              onKeyDown={handleQuantityKeyDown}
              disabled={isProcessing}
              style={{ textAlign: "right" }}
            />
          </div>

          {/* Add button */}
          <button
            type="button"
            className="pos-button pos-button-primary"
            onClick={handleAddItem}
            disabled={isProcessing || !productName.trim() || !lotCode.trim() || quantity < 1}
            style={{ alignSelf: "end" }}
          >
            {t("common.add", { defaultValue: "Agregar" })}
          </button>
        </div>
      </div>

      {/* ── Added Items List ── */}
      {items.length > 0 && (
        <div className="pos-panel p-pos-lg">
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-body-sm)",
              fontWeight: "var(--font-weight-semibold)",
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              margin: "0 0 var(--spacing-pos-md)",
            }}
          >
            {t("returns.items_to_return")}
          </p>

          <div className="flex flex-col gap-pos-sm">
            {items.map((item, index) => (
              <div
                key={`${item.productId}-${index}`}
                className="flex items-center justify-between rounded-pos px-pos-md py-pos-sm"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--color-surface) 40%, white)",
                }}
              >
                <div className="flex items-center gap-pos-lg">
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-body)",
                      fontWeight: "var(--font-weight-medium)",
                      color: "var(--color-ink)",
                    }}
                  >
                    {item.productName}
                  </span>
                  <span className="font-data tabular-nums" style={{ fontSize: "var(--text-body-sm)", color: "var(--color-sync)" }}>
                    {t("sales.product.lot", { defaultValue: "Lote" })}: {item.lotCode}
                  </span>
                  <span className="font-data tabular-nums" style={{ fontSize: "var(--text-body-sm)", color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
                    {t("returns.table_qty")}: {item.quantity}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveItem(index)}
                  disabled={isProcessing}
                  className="flex items-center justify-center rounded-pos"
                  aria-label={`${t("common.remove", { defaultValue: "Eliminar" })} ${item.productName}`}
                  style={{
                    width: 28,
                    height: 28,
                    padding: 0,
                    border: "none",
                    backgroundColor: "transparent",
                    color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                    cursor: "pointer",
                    transition: "color 100ms ease, background-color 100ms ease",
                  }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--color-urgency)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      "color-mix(in srgb, var(--color-urgency) 10%, transparent)";
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color =
                      "color-mix(in srgb, var(--color-ink) 40%, transparent)";
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Manager PIN and Submit ── */}
      <div className="pos-panel p-pos-lg">
        <div className="flex flex-col gap-pos-md">
          <div style={{ maxWidth: 320 }}>
            <label
              htmlFor="manager-pin-input"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-body-sm)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-ink)",
                display: "block",
                marginBottom: "var(--spacing-pos-xs)",
              }}
            >
              {t("returns.manager_pin")}
            </label>
            <input
              id="manager-pin-input"
              type="password"
              className="pos-input font-data tabular-nums"
              maxLength={10}
              value={managerPin}
              onChange={(e) => onManagerPinChange(e.target.value)}
              disabled={isProcessing}
              placeholder="********"
              autoComplete="off"
              style={{
                borderColor: pinError
                  ? "var(--color-urgency)"
                  : undefined,
              }}
            />
            {pinError && (
              <p
                role="alert"
                className="mt-pos-xs"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-caption)",
                  color: "var(--color-urgency)",
                }}
              >
                {pinError}
              </p>
            )}
          </div>

          <button
            type="button"
            className="pos-button pos-button-restrict"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{ alignSelf: "stretch" }}
          >
            {isProcessing
              ? t("returns.processing")
              : t("returns.submit_unverified")}
          </button>
        </div>
      </div>
    </div>
  );
};
