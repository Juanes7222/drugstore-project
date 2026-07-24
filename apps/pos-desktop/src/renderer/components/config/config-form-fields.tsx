/**
 * Reusable form field components for config screens.
 *
 * Uses the app's POS design system: `pos-input`, `pos-button` variants,
 * `pos-badge`, and design tokens for full visual consistency.
 *
 * @category Component
 */

import { type FC } from "react";

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
  className?: string;
  step?: string;
  min?: string | number;
  max?: string | number;
  placeholder?: string;
  suffix?: string;
}

export const TextField: FC<TextFieldProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  type = "text",
  className = "",
  step,
  min,
  max,
  placeholder,
  suffix,
}) => (
  <label className={`block ${className}`}>
    <span className="text-body-sm font-medium text-ink">
      {label}
    </span>
    <div className="relative mt-pos-xs">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        className={`pos-input disabled:cursor-not-allowed disabled:opacity-50 ${suffix ? "pr-8" : ""}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-pos-md top-1/2 -translate-y-1/2 text-caption text-ink-muted">
          {suffix}
        </span>
      )}
    </div>
  </label>
);

// ---------------------------------------------------------------------------
// SelectField
// ---------------------------------------------------------------------------

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export const SelectField: FC<SelectFieldProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  children,
}) => (
  <label className="block">
    <span className="text-body-sm font-medium text-ink">
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="pos-input mt-pos-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  </label>
);

// ---------------------------------------------------------------------------
// CheckboxField
// ---------------------------------------------------------------------------

export interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const CheckboxField: FC<CheckboxFieldProps> = ({
  label,
  checked,
  onChange,
  disabled = false,
}) => (
  <label
    className={`flex cursor-pointer items-center gap-pos-md rounded-sm border border-border bg-panel px-pos-md py-pos-sm transition-colors hover:bg-surface-variant ${
      disabled ? "cursor-not-allowed opacity-50" : ""
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="h-4 w-4 accent-pharma focus:ring-2 focus:ring-pharma/30"
    />
    <span className="text-body-sm text-ink">{label}</span>
  </label>
);

// ---------------------------------------------------------------------------
// TextAreaField
// ---------------------------------------------------------------------------

export interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const TextAreaField: FC<TextAreaFieldProps> = ({
  label,
  value,
  onChange,
  disabled = false,
}) => (
  <label className="block">
    <span className="text-body-sm font-medium text-ink">
      {label}
    </span>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={3}
      className="pos-input mt-pos-xs disabled:cursor-not-allowed disabled:opacity-50"
    />
  </label>
);
