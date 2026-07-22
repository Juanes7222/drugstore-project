/**
 * Client form with animated entrance — create and edit modes.
 *
 * Slides in when mounted, validated fields, icon-enhanced buttons,
 * and a pharma-tinted vs neutral background to distinguish modes.
 */
import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Check, Loader2, Save, User, FileText, Mail, Phone, MapPin, Building, X } from "lucide-react";
import type { CreateClientInput } from "../../../domain/clients/clients.service";

// ---------------------------------------------------------------------------
// Identification type labels (Colombian)
// ---------------------------------------------------------------------------

export const ID_TYPES: { value: string; labelKey: string }[] = [
  { value: "CC", labelKey: "clients.id_type_cc" },
  { value: "NIT", labelKey: "clients.id_type_nit" },
  { value: "CE", labelKey: "clients.id_type_ce" },
  { value: "PASSPORT", labelKey: "clients.id_type_passport" },
  { value: "TI", labelKey: "clients.id_type_ti" },
  { value: "PEP", labelKey: "clients.id_type_pep" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClientFormProps {
  mode: "create" | "edit";
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
  "w-full rounded-sm border px-2 py-1.5 text-body outline-none transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma " +
  "placeholder:text-ink-muted/40";
const LABEL_CLASS = "mb-1 block text-caption font-medium";

// ---------------------------------------------------------------------------
// Field definition — drives the grid declaratively
// ---------------------------------------------------------------------------

interface FieldDef {
  key: keyof CreateClientInput;
  labelKey: string;
  type: "text" | "email" | "tel" | "select";
  required?: boolean;
  colSpan?: "full" | "half";
  icon: React.ReactNode;
  options?: { value: string; labelKey: string }[];
}

const FIELDS: FieldDef[] = [
  { key: "fullName", labelKey: "clients.full_name", type: "text", required: true, colSpan: "full", icon: <User className="size-4" /> },
  { key: "identificationType", labelKey: "clients.id_type", type: "select", required: true, colSpan: "half", icon: <FileText className="size-4" />, options: ID_TYPES },
  { key: "identificationNumber", labelKey: "clients.id_number", type: "text", required: true, colSpan: "half", icon: <FileText className="size-4" /> },
  { key: "email", labelKey: "clients.email", type: "email", colSpan: "half", icon: <Mail className="size-4" /> },
  { key: "phone", labelKey: "clients.phone", type: "tel", colSpan: "half", icon: <Phone className="size-4" /> },
  { key: "address", labelKey: "clients.address", type: "text", colSpan: "full", icon: <MapPin className="size-4" /> },
  { key: "municipality", labelKey: "clients.municipality", type: "text", colSpan: "half", icon: <Building className="size-4" /> },
  { key: "department", labelKey: "clients.department", type: "text", colSpan: "half", icon: <Building className="size-4" /> },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClientForm: FC<ClientFormProps> = ({
  mode,
  data,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}) => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();

  const isValid = data.fullName.trim().length > 0 && data.identificationNumber.trim().length > 0;

  const handleSubmit = useCallback(() => {
    if (isValid && !isSubmitting) onSubmit();
  }, [isValid, isSubmitting, onSubmit]);

  const bgTint =
    mode === "create"
      ? "color-mix(in srgb, var(--color-pharma) 4%, transparent)"
      : "color-mix(in srgb, var(--color-restrict) 4%, transparent)";

  const borderTint =
    mode === "create"
      ? "color-mix(in srgb, var(--color-pharma) 18%, transparent)"
      : "color-mix(in srgb, var(--color-restrict) 18%, transparent)";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0.01 : 0.25,
        ease: "easeOut",
      }}
      className="overflow-hidden rounded-sm"
      style={{ backgroundColor: bgTint, border: `1px solid ${borderTint}` }}
    >
      <div className="p-4">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="flex size-7 items-center justify-center rounded-full"
              style={{
                backgroundColor: mode === "create"
                  ? "color-mix(in srgb, var(--color-pharma) 12%, transparent)"
                  : "color-mix(in srgb, var(--color-restrict) 12%, transparent)",
              }}
            >
              {mode === "create"
                ? <User className="size-4" style={{ color: "var(--color-pharma)" }} />
                : <Save className="size-4" style={{ color: "var(--color-restrict)" }} />
              }
            </div>
            <h3 className="m-0 text-body font-semibold">
              {mode === "create" ? t("clients.create_title") : t("clients.edit_title")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex size-6 items-center justify-center rounded-sm opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Fields grid */}
        <div className="mb-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {FIELDS.map((field) => {
            const value = (data[field.key] ?? "") as string;

            return (
              <div key={field.key} className={field.colSpan === "full" ? "sm:col-span-2" : ""}>
                <label
                  className={LABEL_CLASS}
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  <span className="inline-flex items-center gap-1">
                    <span className="opacity-60">{field.icon}</span>
                    {t(field.labelKey)}
                    {field.required && (
                      <span className="text-xs" style={{ color: "var(--color-urgency)" }}>*</span>
                    )}
                  </span>
                </label>

                {field.type === "select" && field.options ? (
                  <select
                    value={value}
                    onChange={(e) => onChange({ ...data, [field.key]: e.target.value })}
                    className={INPUT_CLASS}
                    style={{
                      backgroundColor: "var(--color-panel)",
                      borderColor: value
                        ? "color-mix(in srgb, var(--color-ink) 15%, transparent)"
                        : "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                    }}
                    aria-label={t(field.labelKey)}
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    value={value}
                    onChange={(e) => onChange({ ...data, [field.key]: e.target.value })}
                    placeholder={t(field.labelKey)}
                    className={INPUT_CLASS}
                    style={{
                      backgroundColor: "var(--color-panel)",
                      borderColor: value
                        ? "color-mix(in srgb, var(--color-ink) 15%, transparent)"
                        : "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                    }}
                    aria-label={t(field.labelKey)}
                    autoComplete={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "off"}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex items-center gap-1.5 text-body-sm"
            style={{ color: "var(--color-urgency)" }}
            role="alert"
          >
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </motion.p>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 border-t pt-3"
          style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-body-sm font-semibold transition-colors"
            style={{
              backgroundColor: "var(--color-panel)",
              color: "var(--color-ink)",
              borderColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)",
            }}
          >
            <X className="size-4" />
            {t("common.cancel")}
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !isValid}
            className="inline-flex items-center gap-1.5 rounded-sm border px-4 py-1.5 text-body-sm font-semibold text-white transition-all"
            style={{
              backgroundColor: mode === "create" ? "var(--color-pharma)" : "var(--color-restrict)",
              opacity: isSubmitting || !isValid ? 0.6 : 1,
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("common.saving")}
              </>
            ) : (
              <>
                {mode === "create" ? <User className="size-4" /> : <Check className="size-4" />}
                {mode === "create" ? t("clients.create") : t("clients.save")}
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
