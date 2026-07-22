/**
 * Fiscal configuration tab — tax regime, DIAN resolution, invoice options.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { TextField, SelectField, CheckboxField, TextAreaField } from "./config-form-fields";
import type { TenantConfig } from "../../../domain/config/types";

// ---------------------------------------------------------------------------
// Tax regime options (Colombian)
// ---------------------------------------------------------------------------

const TAX_REGIMES: Array<{ value: string; labelKey: string }> = [
  { value: "RESPONSABLE_IVA", labelKey: "fiscal.tax_regime_responsable" },
  { value: "NO_RESPONSABLE", labelKey: "fiscal.tax_regime_no_responsable" },
  { value: "SIMPLE", labelKey: "fiscal.tax_regime_simple" },
  { value: "EXENTO", labelKey: "fiscal.tax_regime_exento" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FiscalConfigTabProps {
  config: TenantConfig | null;
  readOnly: boolean;
  onFieldChange: (section: "fiscal" | "workflow", key: string, value: unknown) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FiscalConfigTab: FC<FiscalConfigTabProps> = ({
  config,
  readOnly,
  onFieldChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
        {t("config.tabs.fiscal")}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={t("config.fiscal.tax_regime")}
          value={config?.fiscal.taxRegime ?? "RESPONSABLE_IVA"}
          onChange={(v) => onFieldChange("fiscal", "taxRegime", v)}
          disabled={readOnly}
        >
          {TAX_REGIMES.map((regime) => (
            <option key={regime.value} value={regime.value}>
              {t("config." + regime.labelKey)}
            </option>
          ))}
        </SelectField>

        <TextField
          label={t("config.fiscal.default_tax_rate")}
          value={((config?.fiscal.defaultTaxRate ?? 0.19) * 100).toString()}
          onChange={(v) =>
            onFieldChange("fiscal", "defaultTaxRate", (parseFloat(v) || 0) / 100)
          }
          disabled={readOnly || config?.fiscal.taxRegime === "NO_RESPONSABLE"}
          type="number"
          step="0.01"
          min="0"
          max="100"
          suffix="%"
        />
      </div>

      {/* DIAN Resolution */}
      <div className="border-t border-border pt-6 dark:border-gray-700">
        <h4 className="mb-4 text-sm font-semibold text-ink dark:text-gray-100">
          {t("config.fiscal.dian_resolution")}
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t("config.fiscal.dian_resolution_number")}
            value={config?.fiscal.dianResolutionNumber ?? ""}
            onChange={(v) => onFieldChange("fiscal", "dianResolutionNumber", v)}
            disabled={readOnly}
          />
          <TextField
            label={t("config.fiscal.dian_resolution_date")}
            value={config?.fiscal.dianResolutionDate ?? ""}
            onChange={(v) => onFieldChange("fiscal", "dianResolutionDate", v)}
            disabled={readOnly}
            type="date"
          />
          <TextField
            label={t("config.fiscal.dian_prefix")}
            value={config?.fiscal.dianResolutionPrefix ?? ""}
            onChange={(v) => onFieldChange("fiscal", "dianResolutionPrefix", v)}
            disabled={readOnly}
          />
          <TextField
            label={t("config.fiscal.invoice_number_format")}
            value={config?.fiscal.invoiceNumberFormat ?? ""}
            onChange={(v) => onFieldChange("fiscal", "invoiceNumberFormat", v)}
            disabled={readOnly}
          />
        </div>
      </div>

      {/* Invoice display options */}
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 className="text-sm font-semibold text-ink dark:text-gray-100">
          Pantalla
        </h4>
        <CheckboxField
          label={t("config.fiscal.show_logo_on_receipt")}
          checked={config?.fiscal.showLogoOnReceipt ?? true}
          onChange={(v) => onFieldChange("fiscal", "showLogoOnReceipt", v)}
          disabled={readOnly}
        />
        <CheckboxField
          label={t("config.fiscal.show_qr_on_receipt")}
          checked={config?.fiscal.showQrOnReceipt ?? true}
          onChange={(v) => onFieldChange("fiscal", "showQrOnReceipt", v)}
          disabled={readOnly}
        />
      </div>

      {/* Header / Footer */}
      <div className="grid grid-cols-2 gap-4">
        <TextAreaField
          label={t("config.fiscal.invoice_header")}
          value={config?.fiscal.invoiceHeader ?? ""}
          onChange={(v) => onFieldChange("fiscal", "invoiceHeader", v)}
          disabled={readOnly}
        />
        <TextAreaField
          label={t("config.fiscal.invoice_footer")}
          value={config?.fiscal.invoiceFooter ?? ""}
          onChange={(v) => onFieldChange("fiscal", "invoiceFooter", v)}
          disabled={readOnly}
        />
      </div>
    </div>
  );
};
