/**
 * Reusable form field components for config screens.
 *
 * Exports TextField, SelectField, CheckboxField, and TextAreaField
 * with consistent styling matching the pharma design system.
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
    <span className="text-sm font-medium text-ink dark:text-gray-300">
      {label}
    </span>
    <div className="relative mt-1">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        className={`block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma disabled:cursor-not-allowed disabled:bg-surface-variant disabled:text-ink-muted dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 ${suffix ? "pr-8" : ""}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
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
    <span className="text-sm font-medium text-ink dark:text-gray-300">
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma disabled:cursor-not-allowed disabled:bg-surface-variant disabled:text-ink-muted dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
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
  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 transition-colors hover:bg-surface-variant dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="h-4 w-4 rounded border-border text-pharma focus:ring-pharma disabled:cursor-not-allowed"
    />
    <span className="text-sm text-ink dark:text-gray-100">{label}</span>
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
    <span className="text-sm font-medium text-ink dark:text-gray-300">
      {label}
    </span>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={3}
      className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma disabled:cursor-not-allowed disabled:bg-surface-variant disabled:text-ink-muted dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
    />
  </label>
);
