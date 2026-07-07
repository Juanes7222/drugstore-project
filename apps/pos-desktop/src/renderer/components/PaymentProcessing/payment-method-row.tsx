/**
 * A single payment method entry: type selector, amount input, and (for
 * electronic methods) authorization controls.
 */
import { type ChangeEvent, type FC, useCallback, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CurrencyInput } from "@/components/common/currency-input";
import {
  PaymentMethodEntry,
  PaymentMethodType,
} from "@/store/slices/payment-types";
import { PaymentStatusBadge } from "./payment-status-badge";

interface PaymentMethodRowProps {
  index: number;
  method: PaymentMethodEntry;
  isOnlyMethod: boolean;
  disabled: boolean;
  onTypeChange: (id: string, type: PaymentMethodType) => void;
  onAmountChange: (id: string, amountCents: number) => void;
  onRemove: (id: string) => void;
  onAuthorize: (method: PaymentMethodEntry) => void;
}

const METHOD_OPTIONS: PaymentMethodType[] = [
  PaymentMethodType.CASH,
  PaymentMethodType.CARD,
  PaymentMethodType.TRANSFER,
  PaymentMethodType.NEQUI,
];

export const PaymentMethodRow: FC<PaymentMethodRowProps> = ({
  index,
  method,
  isOnlyMethod,
  disabled,
  onTypeChange,
  onAmountChange,
  onRemove,
  onAuthorize,
}) => {
  const { t } = useTranslation();
  const selectId = useId();

  const isElectronic = useMemo(
    () => method.type !== PaymentMethodType.CASH,
    [method.type],
  );

  const handleTypeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onTypeChange(method.id, event.target.value as PaymentMethodType);
    },
    [method.id, onTypeChange],
  );

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
        <select
          id={selectId}
          value={method.type}
          onChange={handleTypeChange}
          disabled={disabled}
          className="pos-input"
        >
          {METHOD_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`payment.method.${option}`)}
            </option>
          ))}
        </select>
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
