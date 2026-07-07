/**
 * Currency input for Colombian peso amounts.
 *
 * Accepts whole numbers only (COP has no decimal subdivision) and reports the
 * value back to callers as an integer number of cents. The data/mono face with
 * tabular figures is used so amounts align with the rest of the POS.
 */
import {
  type ChangeEvent,
  type FC,
  type InputHTMLAttributes,
  useCallback,
  useId,
} from "react";

interface CurrencyInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "onChange"
  > {
  value: number;
  onChange: (amountCents: number) => void;
  label?: string;
}

export const CurrencyInput: FC<CurrencyInputProps> = ({
  value,
  onChange,
  label,
  id: idProp,
  disabled,
  ...rest
}) => {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;

      if (raw === "") {
        onChange(0);
        return;
      }

      const parsed = Number.parseInt(raw, 10);
      onChange(Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-pos-xs">
      {label && (
        <label
          htmlFor={id}
          className="text-caption font-medium"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {label}
        </label>
      )}
      <div className="relative">
        <span
          className="pointer-events-none absolute left-pos-md top-1/2 -translate-y-1/2 font-data tabular-nums"
          aria-hidden="true"
          style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
        >
          $
        </span>
        <input
          id={id}
          type="number"
          min={0}
          step={1}
          value={value === 0 ? "" : value}
          onChange={handleChange}
          disabled={disabled}
          className="pos-input pl-pos-xl font-data tabular-nums"
          inputMode="numeric"
          {...rest}
        />
      </div>
    </div>
  );
};
