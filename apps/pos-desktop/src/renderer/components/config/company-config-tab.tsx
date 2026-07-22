/**
 * Company configuration tab — company info, NIT, address, and custom fields.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "./config-form-fields";
import { FieldRequirementIndicator } from "./field-requirement-indicator";
import type { TenantConfig, EffectiveConfig, CustomCompanyField } from "../../../domain/config";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CompanyConfigTabProps {
  config: TenantConfig | null;
  effectiveConfig: EffectiveConfig | null;
  readOnly: boolean;
  onFieldChange: (section: "fiscal" | "workflow", key: string, value: unknown) => Promise<void>;
  onAddCustomField: () => void;
  onEditCustomField: (field: CustomCompanyField) => void;
  onRemoveCustomField: (fieldId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CompanyConfigTab: FC<CompanyConfigTabProps> = ({
  config,
  effectiveConfig,
  readOnly,
  onFieldChange,
  onAddCustomField,
  onEditCustomField,
  onRemoveCustomField,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
        {t("config.fiscal.company_name")}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t("config.fiscal.company_name")}
          value={config?.fiscal.companyName ?? ""}
          onChange={(v) => onFieldChange("fiscal", "companyName", v)}
          disabled={readOnly}
        />
        <TextField
          label={t("config.fiscal.nit")}
          value={config?.fiscal.nit ?? ""}
          onChange={(v) => onFieldChange("fiscal", "nit", v)}
          disabled={readOnly}
        />
        <TextField
          label={t("config.fiscal.address")}
          value={config?.fiscal.address ?? ""}
          onChange={(v) => onFieldChange("fiscal", "address", v)}
          disabled={readOnly}
          className="col-span-2"
        />
        <TextField
          label={t("config.fiscal.city")}
          value={config?.fiscal.city ?? ""}
          onChange={(v) => onFieldChange("fiscal", "city", v)}
          disabled={readOnly}
        />
        <TextField
          label={t("config.fiscal.phone")}
          value={config?.fiscal.phone ?? ""}
          onChange={(v) => onFieldChange("fiscal", "phone", v)}
          disabled={readOnly}
        />
        <TextField
          label={t("config.fiscal.email")}
          value={config?.fiscal.email ?? ""}
          onChange={(v) => onFieldChange("fiscal", "email", v)}
          disabled={readOnly}
          type="email"
        />
      </div>

      {/* Custom fields section */}
      <div className="border-t border-border pt-6 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink dark:text-gray-100">
            {t("config.custom_fields.title")}
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={onAddCustomField}
              className="inline-flex items-center gap-1 rounded-lg bg-pharma px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pharma/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("config.custom_fields.add")}
            </button>
          )}
        </div>

        {!effectiveConfig?.customCompanyFields ||
        effectiveConfig.customCompanyFields.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted dark:text-gray-400">
            {t("config.custom_fields.add")}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {effectiveConfig.customCompanyFields.map((field) => (
              <div
                key={field.id}
                className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink dark:text-gray-100">
                      {field.name}
                    </span>
                    <span className="text-xs text-ink-muted">({field.key})</span>
                    <FieldRequirementIndicator
                      requirement={field.required ? "REQUIRED" : "OPTIONAL"}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted dark:text-gray-400">
                    {t(
                      "config.custom_fields." +
                        (field.type.toLowerCase() as "text" | "number" | "date" | "url" | "email"),
                    )}
                    {field.showOnInvoice && ` — ${t("config.custom_fields.show_on_invoice")}`}
                    {field.showOnReport && ` — ${t("config.custom_fields.show_on_report")}`}
                  </p>
                </div>
                {!readOnly && (
                  <div className="ml-4 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEditCustomField(field)}
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-variant hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma dark:hover:bg-gray-700"
                      aria-label={`${t("config.custom_fields.edit")} ${field.name}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveCustomField(field.id)}
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-error-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error dark:hover:bg-red-900/20"
                      aria-label={`${t("config.custom_fields.remove")} ${field.name}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
