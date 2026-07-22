/**
 * System preferences tab — workflow toggles (auto-print, drawer, suggestions).
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField, SelectField } from "./config-form-fields";
import type { TenantConfig } from "../../../domain/config/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SystemPreferencesTabProps {
  config: TenantConfig | null;
  readOnly: boolean;
  onFieldChange: (section: "fiscal" | "workflow", key: string, value: unknown) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SystemPreferencesTab: FC<SystemPreferencesTabProps> = ({
  config,
  readOnly,
  onFieldChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
        {t("config.tabs.preferences")}
      </h3>

      <div className="space-y-3">
        <CheckboxField
          label={t("config.workflow.auto_print_on_confirm")}
          checked={config?.workflow.autoPrintOnConfirm ?? true}
          onChange={(v) => onFieldChange("workflow", "autoPrintOnConfirm", v)}
          disabled={readOnly}
        />
        <CheckboxField
          label={t("config.workflow.print_duplicate_receipt")}
          checked={config?.workflow.printDuplicateReceipt ?? false}
          onChange={(v) => onFieldChange("workflow", "printDuplicateReceipt", v)}
          disabled={readOnly}
        />
        <SelectField
          label={t("config.workflow.auto_open_drawer_on_confirm")}
          value={config?.workflow.autoOpenDrawerOnConfirm ?? "CASH_ONLY"}
          onChange={(v) => onFieldChange("workflow", "autoOpenDrawerOnConfirm", v)}
          disabled={readOnly}
        >
          <option value="ALWAYS">Siempre</option>
          <option value="CASH_ONLY">Solo efectivo</option>
          <option value="NEVER">Nunca</option>
        </SelectField>
        <CheckboxField
          label={t("config.workflow.suggestion_engine")}
          checked={config?.workflow.suggestionEngineEnabled ?? true}
          onChange={(v) => onFieldChange("workflow", "suggestionEngineEnabled", v)}
          disabled={readOnly}
        />
      </div>
    </div>
  );
};
