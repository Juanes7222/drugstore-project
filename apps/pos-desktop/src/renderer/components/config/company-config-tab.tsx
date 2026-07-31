/**
 * Company configuration tab — company info, NIT, address, and custom fields.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { PencilIcon, PlusIcon, Trash2Icon } from "@/components/ui/icons";
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
      <h3 className="text-ui font-semibold text-ink">
        {t("config.fiscal.company_name")}
      </h3>

      <div className="grid grid-cols-2 gap-pos-md">
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
      <div className="pos-divider pt-6" />
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-ui font-semibold text-ink">
            {t("config.custom_fields.title")}
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={onAddCustomField}
              className="pos-button pos-button-primary flex items-center gap-pos-xs"
            >
              <PlusIcon size={14} strokeWidth={1.5} aria-hidden="true" />
              {t("config.custom_fields.add")}
            </button>
          )}
        </div>

        {!effectiveConfig?.customCompanyFields ||
        effectiveConfig.customCompanyFields.length === 0 ? (
          <p className="mt-pos-sm text-body-sm text-ink-muted">
            {t("config.custom_fields.no_fields")}
          </p>
        ) : (
          <div className="mt-pos-md space-y-pos-xs">
            {effectiveConfig.customCompanyFields.map((field) => (
              <div
                key={field.id}
                className="flex items-center justify-between rounded-sm border border-border bg-panel px-pos-md py-pos-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-pos-sm">
                      <span className="text-body-sm font-medium text-ink">
                        {field.name}
                      </span>
                    <span className="text-caption text-ink-muted">({field.key})</span>
                    <FieldRequirementIndicator
                      requirement={field.required ? "REQUIRED" : "OPTIONAL"}
                    />
                  </div>
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {t(
                      "config.custom_fields." +
                        (field.type.toLowerCase() as "text" | "number" | "date" | "url" | "email"),
                    )}
                    {field.showOnInvoice && ` — ${t("config.custom_fields.show_on_invoice")}`}
                    {field.showOnReport && ` — ${t("config.custom_fields.show_on_report")}`}
                  </p>
                </div>
                {!readOnly && (
                  <div className="ml-pos-md flex shrink-0 items-center gap-pos-xs">
                    <button
                      type="button"
                      onClick={() => onEditCustomField(field)}
                      className="pos-button pos-button-secondary p-1.5"
                      aria-label={`${t("config.custom_fields.edit")} ${field.name}`}
                    >
                      <PencilIcon size={14} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveCustomField(field.id)}
                      className="pos-button pos-button-secondary p-1.5 hover:bg-error-container hover:text-error focus-visible:outline-error"
                      aria-label={`${t("config.custom_fields.remove")} ${field.name}`}
                    >
                      <Trash2Icon size={14} strokeWidth={1.5} aria-hidden="true" />
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
