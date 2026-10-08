/**
 * UnverifiedReturnFlow — manager-override return of a sale that belongs to
 * another workstation.
 *
 * "Unverified" means the sale is not this workstation's own: it is recognised
 * only through the shared sale history pulled from the server, so confirming it
 * locally requires an ADMIN role and a manager PIN. Both tabs therefore return
 * against a real stored sale; this one additionally passes
 * `managerOverride: true` to `ReturnsService.confirm`.
 *
 * Uses the restrict-violet accent to visually distinguish this flow's higher
 * regulatory weight.
 *
 * @category Component
 */

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { PaymentMethodPicker } from "@/components/common/payment-method-picker";
import type { PaymentMethodOption } from "@/store/slices/payment-types";
import type { SaleSearchResult } from "./returns.types";
import { formatCents } from "./returns.types";
import { ReturnSaleItemsTable } from "./return-sale-items-table";

interface UnverifiedReturnFlowProps {
  /** Current search query for the sale. */
  searchQuery: string;
  /** Called when the search query changes. */
  onSearchQueryChange: (value: string) => void;
  /** Called to run the sale search. */
  onSearch: () => void;
  /** Key handler for the search field. */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Search error message, or null. */
  searchError: string | null;
  /** The sale found by the search, or null. */
  foundSale: SaleSearchResult | null;
  /** Ids of the sale items selected for return. */
  selectedItemIds: Set<string>;
  /** Called to toggle an item's selection. */
  onToggleItem: (itemId: string) => void;
  /** Current manager PIN input value. */
  managerPin: string;
  /** Called when the PIN input changes. */
  onManagerPinChange: (pin: string) => void;
  /** Error message for the PIN field, or null. */
  pinError: string | null;
  /** Active payment methods from the DB (refund method options). */
  refundMethods: PaymentMethodOption[];
  /** Selected refund method id. */
  refundMethodId: string;
  /** Called when the refund method changes. */
  onRefundMethodChange: (method: PaymentMethodOption) => void;
  /** Whether the submission is in progress. */
  isProcessing: boolean;
  /** Called to submit the unverified return. */
  onSubmit: () => void;
  /** Whether the submit button should be enabled. */
  canSubmit: boolean;
}

export const UnverifiedReturnFlow: FC<UnverifiedReturnFlowProps> = ({
  searchQuery,
  onSearchQueryChange,
  onSearch,
  onKeyDown,
  searchError,
  foundSale,
  selectedItemIds,
  onToggleItem,
  managerPin,
  onManagerPinChange,
  pinError,
  refundMethods,
  refundMethodId,
  onRefundMethodChange,
  isProcessing,
  onSubmit,
  canSubmit,
}) => {
  const { t } = useTranslation();

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

      {/* ── Sale search ── */}
      <div className="pos-panel p-pos-lg">
        <label
          htmlFor="unverified-sale-search"
          className="text-caption font-medium"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("returns.search_label")}
        </label>
        <div className="flex gap-pos-sm">
          <input
            id="unverified-sale-search"
            type="text"
            className="pos-input font-data"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isProcessing}
            placeholder={t("returns.search_placeholder")}
            autoComplete="off"
          />
          <button
            type="button"
            className="pos-button pos-button-primary"
            onClick={onSearch}
            disabled={isProcessing || !searchQuery.trim()}
            aria-label={t("returns.search_button")}
          >
            {t("returns.search_button")}
          </button>
        </div>
        {searchError && (
          <p
            role="alert"
            className="mt-pos-xs"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-caption)",
              color: "var(--color-urgency)",
            }}
          >
            {searchError}
          </p>
        )}
      </div>

      {/* ── Found sale and its items ── */}
      {foundSale && (
        <div className="pos-panel p-pos-lg">
          <div className="mb-pos-md flex items-center justify-between">
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-body-sm)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-ink)",
                margin: 0,
              }}
            >
              {t("returns.found_sale", {
                number: foundSale.sequentialNumber,
                workstation: foundSale.workstationName,
              })}
            </p>
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-body-sm)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-ink)",
              }}
            >
              {formatCents(foundSale.totalCents)}
            </span>
          </div>

          <ReturnSaleItemsTable
            sale={foundSale}
            selectedItemIds={selectedItemIds}
            onToggleItem={onToggleItem}
            isProcessing={isProcessing}
          />
        </div>
      )}

      {/* ── Manager PIN and submit ── */}
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
                borderColor: pinError ? "var(--color-urgency)" : undefined,
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

          <div className="flex flex-col gap-pos-sm">
            <label
              htmlFor="unverified-refund-method"
              className="text-caption font-medium"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("returns.refund_method_label")}
            </label>
            <PaymentMethodPicker
              id="unverified-refund-method"
              value={refundMethodId}
              methods={refundMethods}
              onChange={onRefundMethodChange}
              disabled={isProcessing}
              ariaLabel={t("returns.refund_method_label")}
            />
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
