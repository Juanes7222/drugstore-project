/**
 * PaymentMethodPicker — shared payment-method selector.
 *
 * Every section that lets the cashier pick a payment method (sales payment
 * rows, fiscal adjustments, returns) uses this component so the methods
 * always come from the same place: the local DB `PaymentMethod` rows synced
 * from the server with DIAN categories. Nothing is hardcoded here.
 *
 * Pass `methods` to reuse an already-loaded list (e.g. the active methods
 * loaded by the parent); when omitted the component loads them itself via
 * `useActivePaymentMethods`.
 */
import { type FC, useId } from "react";
import { useActivePaymentMethods } from "@/hooks/use-active-payment-methods";
import type { PaymentMethodOption } from "@/store/slices/payment-types";

export interface PaymentMethodPickerProps {
  /** Currently selected `paymentMethodId`, or "" for none. */
  value: string;
  /** Called with the full DB payment method when the selection changes. */
  onChange: (method: PaymentMethodOption) => void;
  /** Optional preloaded list — avoids a second DB read. */
  methods?: PaymentMethodOption[];
  disabled?: boolean;
  /** Render an empty "—" option so the cashier can unselect. */
  includePlaceholder?: boolean;
  /** Accessible name for the select. */
  ariaLabel: string;
  id?: string;
}

export const PaymentMethodPicker: FC<PaymentMethodPickerProps> = ({
  value,
  onChange,
  methods,
  disabled = false,
  includePlaceholder = false,
  ariaLabel,
  id,
}) => {
  const autoId = useId();
  const selectId = id ?? autoId;
  const { methods: loadedMethods } = useActivePaymentMethods();
  const options = methods ?? loadedMethods;

  const handleChange = (methodId: string) => {
    const method = options.find((m) => m.id === methodId);
    if (method) {
      onChange(method);
    }
  };

  return (
    <select
      id={selectId}
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className="pos-input text-body-sm"
    >
      {includePlaceholder && <option value="">—</option>}
      {options.map((method) => (
        <option key={method.id} value={method.id}>
          {method.name}
        </option>
      ))}
    </select>
  );
};
