/**
 * A single payment method entry: method selector, amount input, and (for
 * electronic methods) authorization controls.
 *
 * The method selector is the shared `PaymentMethodPicker`, so the options
 * come from the local DB (DIAN categories) — never a hardcoded list.
 */
import { type FC, type KeyboardEvent, type Ref, useCallback, useId } from "react";
import { useTranslation } from "react-i18next";
import { CurrencyInput } from "@/components/common/currency-input";
import { PaymentMethodPicker } from "@/components/common/payment-method-picker";
import {
  PaymentMethodEntry,
  PaymentMethodOption,
} from "@/store/slices/payment-types";
import { PaymentStatusBadge } from "./payment-status-badge";

interface PaymentMethodRowProps {
  index: number;
  method: PaymentMethodEntry;
  /** Active payment methods from the DB (shared picker options). */
  methods: PaymentMethodOption[];
  isOnlyMethod: boolean;
  disabled: boolean;
  /** Keyboard-selected row: renders the cart selection signature. */
  isActive?: boolean;
  /** Forwarded to the amount input (payment screen focuses it from the keyboard selection). */
  inputRef?: Ref<HTMLInputElement>;
  /** Whether the cash "received" field is part of keyboard navigation. */
  showCashReceived?: boolean;
  /** Enter on a cash row's amount input moves the selection to "received". */
  onMoveToReceived?: () => void;
  onMethodChange: (id: string, method: PaymentMethodOption) => void;
  onAmountChange: (id: string, amountCents: number) => void;
  onRemove: (id: string) => void;
  onAuthorize: (method: PaymentMethodEntry) => void;
}

export const PaymentMethodRow: FC<PaymentMethodRowProps> = ({
  index,
  method,
  methods,
  isOnlyMethod,
  disabled,
  isActive = false,
  inputRef,
  showCashReceived = false,
  onMoveToReceived = () => {},
  onMethodChange,
  onAmountChange,
  onRemove,
  onAuthorize,
}) => {
  const { t } = useTranslation();
  const selectId = useId();

  // Store credit is not gateway-backed — it never shows the authorization
  // badge. Only actual electronic methods (card, transfer, wallet) do.
  const isElectronic = !method.isCash && method.category !== "CREDIT";

  const handleAmountChange = useCallback(
    (amountCents: number) => {
      onAmountChange(method.id, amountCents);
    },
    [method.id, onAmountChange],
  );

  const handleRemove = useCallback(() => {
    onRemove(method.id);
  }, [method.id, onRemove]);

  const handleAuthorize = useCallback(() => {
    onAuthorize(method);
  }, [method, onAuthorize]);

  // Enter-per-input semantics: only this row knows what its amount input
  // belongs to. Electronic rows authorize (when an amount is typed); a cash
  // row moves the keyboard selection to "received" when change is due.
  const handleAmountKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      if (isElectronic && method.amountCents > 0) {
        event.preventDefault();
        handleAuthorize();
      } else if (method.isCash && showCashReceived) {
        event.preventDefault();
        onMoveToReceived();
      }
    },
    [
      isElectronic,
      method.amountCents,
      method.isCash,
      showCashReceived,
      handleAuthorize,
      onMoveToReceived,
    ],
  );

  return (
    <div
      className="grid items-start gap-pos-md py-pos-md pl-pos-md pr-pos-sm"
      style={{
        gridTemplateColumns: "1fr 1fr auto",
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
        ...(isActive
          ? {
              backgroundColor:
                "color-mix(in srgb, var(--color-pharma) 6%, transparent)",
              boxShadow: "inset 3px 0 0 var(--color-pharma)",
            }
          : {}),
      }}
    >
      <div className="flex flex-col gap-pos-xs">
        <div className="flex items-center gap-pos-xs">
          {isActive && (
            <span
              aria-hidden="true"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-pos-sm border font-data text-caption tabular-nums"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-pharma) 30%, transparent)",
                color: "color-mix(in srgb, var(--color-pharma) 80%, transparent)",
              }}
            >
              {index + 1}
            </span>
          )}
          <label
            htmlFor={selectId}
            className="text-caption font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("payment.method_label", { number: index + 1 })}
          </label>
        </div>
        <PaymentMethodPicker
          id={selectId}
          value={method.paymentMethodId}
          methods={methods}
          onChange={(selected) => onMethodChange(method.id, selected)}
          disabled={disabled}
          ariaLabel={t("payment.method_label", { number: index + 1 })}
        />
      </div>

      <CurrencyInput
        value={method.amountCents}
        onChange={handleAmountChange}
        label={t("payment.amount_label")}
        disabled={disabled}
        aria-label={t("payment.amount_label")}
        inputRef={inputRef}
        onKeyDown={handleAmountKeyDown}
      />

      <div className="flex items-end gap-pos-sm pt-[1.375rem]">
        {isElectronic && (
          <PaymentStatusBadge
            method={method}
            onAuthorize={handleAuthorize}
            disabled={disabled}
          />
        )}

        {!isOnlyMethod && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={disabled}
            className="pos-button pos-button-secondary px-pos-sm py-pos-xs text-caption"
            aria-label={t("payment.remove_method")}
          >
            {t("common.remove")}
          </button>
        )}
      </div>
    </div>
  );
};
