/**
 * Quick client create form — compact inline version used inside the
 * client-selector dropdown during a sale.
 *
 * Shows all CreateClientInput fields in a 2-column grid.
 * Only fullName and identificationNumber are required.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { CreateClientInput } from "../../../domain/clients";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface QuickClientFormProps {
  data: CreateClientInput;
  onChange: (data: CreateClientInput) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  "w-full rounded-sm border px-2 py-1 text-body outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pharma";
const LABEL_CLASS = "mb-0.5 block text-caption";
const LABEL_COLOR = "color-mix(in srgb, var(--color-ink) 60%, transparent)";
const BORDER_COLOR = "color-mix(in srgb, var(--color-ink) 12%, transparent)";

// ---------------------------------------------------------------------------
// Field definitions — matches the full ClientForm but no animated wrappers
// ---------------------------------------------------------------------------

interface FieldDef {
  key: keyof CreateClientInput;
  labelKey: string;
  type: "text" | "email" | "tel" | "select";
  required?: boolean;
  colSpan?: "full" | "half";
  autoComplete?: string;
  options?: { value: string; labelKey: string }[];
}

const FIELDS: FieldDef[] = [
  { key: "fullName", labelKey: "clients.full_name", type: "text", required: true, colSpan: "full" },
  { key: "identificationType", labelKey: "clients.id_type", type: "select", colSpan: "half", options: [
    { value: "CC", labelKey: "CC" },
    { value: "NIT", labelKey: "NIT" },
    { value: "CE", labelKey: "CE" },
    { value: "PASSPORT", labelKey: "clients.id_type_passport" },
    { value: "TI", labelKey: "TI" },
    { value: "PEP", labelKey: "PEP" },
  ]},
  { key: "identificationNumber", labelKey: "clients.id_number", type: "text", required: true, colSpan: "half" },
  { key: "email", labelKey: "clients.email", type: "email", colSpan: "half", autoComplete: "email" },
  { key: "phone", labelKey: "clients.phone", type: "tel", colSpan: "half", autoComplete: "tel" },
  { key: "address", labelKey: "clients.address", type: "text", colSpan: "full", autoComplete: "street-address" },
  { key: "municipality", labelKey: "clients.municipality", type: "text", colSpan: "half" },
  { key: "department", labelKey: "clients.department", type: "text", colSpan: "half" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const QuickClientForm: FC<QuickClientFormProps> = ({
  data,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}) => {
  const { t } = useTranslation();

  const isValid = data.fullName.trim().length > 0 && data.identificationNumber.trim().length > 0;

  return (
    <div className="p-3">
      <h4 className="mb-2 text-caption font-semibold" style={{ color: LABEL_COLOR }}>
        {t("clients.create_title")}
      </h4>

      <div className="mb-2 grid grid-cols-2 gap-2">
        {FIELDS.map((field) => {
          const value = (data[field.key] ?? "") as string;

          return (
            <div key={field.key} className={field.colSpan === "full" ? "col-span-2" : ""}>
              <label className={LABEL_CLASS} style={{ color: LABEL_COLOR }}>
                {t(field.labelKey)}
                {field.required && (
                  <span className="text-xs" style={{ color: "var(--color-urgency)" }}> *</span>
                )}
              </label>

              {field.type === "select" && field.options ? (
                <select
                  value={value}
                  onChange={(e) => onChange({ ...data, [field.key]: e.target.value })}
                  className={INPUT_CLASS}
                  style={{ backgroundColor: "var(--color-panel)", borderColor: BORDER_COLOR }}
                  aria-label={t(field.labelKey)}
                >
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.labelKey.startsWith("clients.") ? t(opt.labelKey) : opt.labelKey}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={value}
                  onChange={(e) => onChange({ ...data, [field.key]: e.target.value })}
                  className={INPUT_CLASS}
                  style={{ backgroundColor: "var(--color-panel)", borderColor: BORDER_COLOR }}
                  placeholder={t(field.labelKey)}
                  aria-label={t(field.labelKey)}
                  autoComplete={field.autoComplete ?? "off"}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <p
          className="mb-2 flex items-center gap-1 text-body-sm"
          style={{ color: "var(--color-urgency)" }}
          role="alert"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onMouseDown={onCancel}
          className="rounded-sm border px-2.5 py-1 text-body-sm transition-colors"
          style={{
            backgroundColor: "var(--color-panel)",
            color: "var(--color-ink)",
            borderColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)",
          }}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onMouseDown={onSubmit}
          disabled={isSubmitting || !isValid}
          className="inline-flex items-center gap-1 rounded-sm border px-3 py-1 text-body-sm font-semibold text-white transition-all"
          style={{
            backgroundColor: "var(--color-pharma)",
            opacity: isSubmitting || !isValid ? 0.6 : 1,
          }}
        >
          {isSubmitting ? (
            <>
              <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              {t("common.saving")}
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {t("clients.create")}
            </>
          )}
        </button>
      </div>
    </div>
  );
};
