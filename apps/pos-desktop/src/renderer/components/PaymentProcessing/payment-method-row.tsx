/**
 * A single payment method entry: method selector, amount input, and (for
 * electronic methods) authorization controls.
 *
 * The method selector is the shared `PaymentMethodPicker`, so the options
 * come from the local DB (DIAN categories) — never a hardcoded list.
 */
import { type FC, useCallback, useId } from "react";
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
  onMethodChange,
  onAmountChange,
  onRemove,
  onAuthorize,
}) => {
  const { t } = useTranslation();
  const selectId = useId();

  const isElectronic = !method.isCash;

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

  return (
    <div
      className="grid items-start gap-pos-md py-pos-md"
      style={{
        gridTemplateColumns: "1fr 1fr auto",
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
      }}
    >
      <div className="flex flex-col gap-pos-xs">
        <label
          htmlFor={selectId}
          className="text-caption font-medium"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("payment.method_label", { number: index + 1 })}
        </label>
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
