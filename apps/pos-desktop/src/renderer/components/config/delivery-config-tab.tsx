/**
 * DeliveryConfigTab — "Domicilios" configuration: master switch, delivery
 * sale requirements, shipping fee policy and receipt printing.
 *
 * Writes through the page's generic handler: every change calls
 * `onFieldChange("workflow", "delivery", { ...config.workflow.delivery, [key]: value })`
 * so the rest of the delivery object is preserved. All controls are gated
 * by `readOnly` and only render while the delivery module is enabled.
 *
 * @category Config Tab
 */

import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleIcon,
  DollarSignIcon,
  PrinterIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import {
  validateTenantConfig,
  type DeliveryConfig,
  type DeliveryFeeMode,
  type TenantConfig,
} from "../../../domain/config";

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

interface SectionDef {
  id: string;
  Icon: IconComponent;
  titleKey: string;
  descKey: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: "active",
    Icon: TruckIcon,
    titleKey: "config.delivery.sectionActive",
    descKey: "config.delivery.sectionActiveDesc",
  },
  {
    id: "requirements",
    Icon: UsersIcon,
    titleKey: "config.delivery.sectionRequirements",
    descKey: "config.delivery.sectionRequirementsDesc",
  },
  {
    id: "fee",
    Icon: DollarSignIcon,
    titleKey: "config.delivery.sectionFee",
    descKey: "config.delivery.sectionFeeDesc",
  },
  {
    id: "receipt",
    Icon: PrinterIcon,
    titleKey: "config.delivery.sectionReceipt",
    descKey: "config.delivery.sectionReceiptDesc",
  },
];

const FEE_MODES: Array<{ value: DeliveryFeeMode; labelKey: string }> = [
  { value: "DISABLED", labelKey: "config.delivery.feeModeDisabled" },
  { value: "FIXED", labelKey: "config.delivery.feeModeFixed" },
  { value: "MANUAL", labelKey: "config.delivery.feeModeManual" },
];

/** Maps a delivery validation path suffix to its user-facing i18n key. */
const DELIVERY_ERROR_I18N_KEYS: Record<string, string> = {
  fixedDeliveryFeeCents: "config.delivery.fixedFeeError",
  maxDeliveryFeeCents: "config.delivery.maxFeeError",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats cents as whole pesos in the Colombian locale, e.g. 500000 -> "5.000". */
const formatPesos = (cents: number): string =>
  Math.round(cents / 100).toLocaleString("es-CO");

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

const ToggleSwitch: FC<{
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ id, checked, onChange, disabled = false }) => {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
        border-2 border-transparent transition-colors duration-200
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma
        disabled:cursor-not-allowed disabled:opacity-50
        ${checked ? "bg-pharma" : "bg-border"}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200
          ${checked ? "translate-x-4" : "translate-x-0"}
        `}
      />
    </button>
  );
};

const ToggleRow: FC<{
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, label, hint, checked, disabled = false, onChange }) => {
  return (
    <div className="flex items-start gap-4 px-pos-xl py-pos-md hover:bg-surface/40 transition-colors">
      <div className="flex-1 min-w-0">
        <label
          htmlFor={id}
          className="text-body-sm font-medium text-ink cursor-pointer"
        >
          {label}
        </label>
        <p className="mt-0.5 text-body-xs text-ink-muted">{hint}</p>
      </div>
      <ToggleSwitch
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
};

const FeeModeOption: FC<{
  value: DeliveryFeeMode;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: DeliveryFeeMode) => void;
}> = ({ value, label, checked, disabled = false, onChange }) => {
  return (
    <label
      className={`
        flex items-center gap-2 rounded border px-3 py-1.5 text-body-sm
        transition-colors duration-150
        focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-pharma
        ${
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:border-pharma/50 hover:text-ink"
        }
        ${checked ? "border-pharma bg-pharma/5 text-ink" : "border-border bg-surface text-ink-muted"}
      `}
    >
      <input
        type="radio"
        name="delivery-fee-mode"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
};

const MoneyField: FC<{
  id: string;
  label: string;
  hint: string;
  valueCents: number;
  disabled?: boolean;
  error?: string;
  onChange: (cents: number) => void;
}> = ({ id, label, hint, valueCents, disabled = false, error, onChange }) => {
  const { t } = useTranslation();
  const errorId = `${id}-error`;

  return (
    <div className="px-pos-xl py-pos-md">
      <label htmlFor={id} className="text-body-sm font-medium text-ink">
        {label}
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-body-xs text-ink-muted">
        {hint}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-body-sm text-ink-muted" aria-hidden="true">
          {t("config.delivery.currencySymbol")}
        </span>
        <input
          type="text"
          inputMode="numeric"
          id={id}
          aria-invalid={error !== undefined}
          aria-describedby={error ? `${id}-hint ${errorId}` : `${id}-hint`}
          value={formatPesos(valueCents)}
          disabled={disabled}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            onChange(digits === "" ? 0 : Number(digits) * 100);
          }}
          className={`
            w-36 rounded border bg-surface px-3 py-1.5 text-body-sm text-ink font-data tabular-nums
            transition-colors focus:outline-none focus:ring-1
            disabled:cursor-not-allowed disabled:opacity-50
            ${
              error
                ? "border-error focus:border-error focus:ring-error"
                : "border-border hover:border-pharma/50 focus:border-pharma focus:ring-pharma"
            }
          `}
        />
        <span className="text-body-xs text-ink-muted" aria-hidden="true">
          {t("config.delivery.currency")}
        </span>
      </div>
      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-1 text-caption text-error">
          {error}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab component
// ---------------------------------------------------------------------------

export interface DeliveryConfigTabProps {
  config: TenantConfig | null;
  readOnly: boolean;
  onFieldChange: (
    section: "fiscal" | "workflow",
    key: string,
    value: unknown,
  ) => Promise<void>;
}

export const DeliveryConfigTab: FC<DeliveryConfigTabProps> = ({
  config,
  readOnly,
  onFieldChange,
}) => {
  const { t } = useTranslation();

  // Fee-field validation errors, keyed by delivery path suffix
  // (e.g. "fixedDeliveryFeeCents") and holding the i18n key of the message.
  const [feeErrors, setFeeErrors] = useState<Record<string, string>>({});

  const delivery = config?.workflow.delivery;
  const disabled = readOnly || !delivery;

  const updateDeliveryField = useCallback(
    async (key: keyof DeliveryConfig, value: DeliveryConfig[keyof DeliveryConfig]) => {
      if (!config) return;

      // Validate the would-be delivery object locally so an invalid
      // combination is never PUT to the server (mirrors validation.ts:204/220).
      const nextDelivery = { ...config.workflow.delivery, [key]: value };
      const deliveryErrors = validateTenantConfig({
        workflow: { ...config.workflow, delivery: nextDelivery },
      }).filter((error) => error.path.startsWith("workflow.delivery."));

      if (deliveryErrors.length > 0) {
        setFeeErrors((prev) => {
          const next = { ...prev };
          for (const error of deliveryErrors) {
            const suffix = error.path.replace("workflow.delivery.", "");
            const i18nKey = DELIVERY_ERROR_I18N_KEYS[suffix];
            if (i18nKey) next[suffix] = i18nKey;
          }
          return next;
        });
        return;
      }

      setFeeErrors({});
      await onFieldChange("workflow", "delivery", nextDelivery);
    },
    [config, onFieldChange],
  );

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-body-sm text-ink-muted">
          {t("config.delivery.description")}
        </p>
        <span className="inline-flex items-center gap-1.5 text-body-xs text-ink-muted">
          <CheckCircleIcon size={12} aria-hidden="true" strokeWidth={1.5} />
          {t("config.delivery.autoSave")}
        </span>
      </div>

      {SECTIONS.map((section) => {
        // Everything below the master switch only renders while enabled.
        if (section.id !== "active" && !delivery?.enabled) return null;
        const SectionIcon = section.Icon;
        return (
          <section
            key={section.id}
            className="rounded-sm bg-panel shadow-pos-panel"
            aria-labelledby={`delivery-section-${section.id}-title`}
          >
            {/* Section header */}
            <div className="flex items-center gap-2 border-b border-border px-pos-xl py-pos-md">
              <SectionIcon
                size={18}
                strokeWidth={1.5}
                className="text-pharma"
                aria-hidden="true"
              />
              <h3
                id={`delivery-section-${section.id}-title`}
                className="text-ui font-medium text-ink"
              >
                {t(section.titleKey)}
              </h3>
            </div>
            <p className="px-pos-xl py-pos-sm text-body-xs text-ink-muted">
              {t(section.descKey)}
            </p>

            {/* Section body — different shape per section */}
            {section.id === "active" && (
              <div className="divide-y divide-border">
                <ToggleRow
                  id="delivery-enabled"
                  label={t("config.delivery.enabled")}
                  hint={t("config.delivery.enabledHint")}
                  checked={delivery?.enabled ?? false}
                  disabled={disabled}
                  onChange={(checked) => updateDeliveryField("enabled", checked)}
                />
              </div>
            )}

            {section.id === "requirements" && (
              <div className="divide-y divide-border">
                <ToggleRow
                  id="delivery-requires-client"
                  label={t("config.delivery.requiresClient")}
                  hint={t("config.delivery.requiresClientHint")}
                  checked={delivery?.requiresClient ?? false}
                  disabled={disabled}
                  onChange={(checked) => updateDeliveryField("requiresClient", checked)}
                />
                <ToggleRow
                  id="delivery-address-required"
                  label={t("config.delivery.addressRequired")}
                  hint={t("config.delivery.addressRequiredHint")}
                  checked={delivery?.addressRequired ?? false}
                  disabled={disabled}
                  onChange={(checked) => updateDeliveryField("addressRequired", checked)}
                />
                <ToggleRow
                  id="delivery-phone-required"
                  label={t("config.delivery.phoneRequired")}
                  hint={t("config.delivery.phoneRequiredHint")}
                  checked={delivery?.phoneRequired ?? false}
                  disabled={disabled}
                  onChange={(checked) => updateDeliveryField("phoneRequired", checked)}
                />
                <ToggleRow
                  id="delivery-allow-scheduling"
                  label={t("config.delivery.allowScheduling")}
                  hint={t("config.delivery.allowSchedulingHint")}
                  checked={delivery?.allowScheduling ?? false}
                  disabled={disabled}
                  onChange={(checked) => updateDeliveryField("allowScheduling", checked)}
                />
                <ToggleRow
                  id="delivery-status-tracking"
                  label={t("config.delivery.enableStatusTracking")}
                  hint={t("config.delivery.enableStatusTrackingHint")}
                  checked={delivery?.enableStatusTracking ?? false}
                  disabled={disabled}
                  onChange={(checked) => updateDeliveryField("enableStatusTracking", checked)}
                />
              </div>
            )}

            {section.id === "fee" && (
              <div className="divide-y divide-border">
                <div className="px-pos-xl py-pos-md">
                  <fieldset disabled={disabled}>
                    <legend className="text-body-sm font-medium text-ink">
                      {t("config.delivery.feeMode")}
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {FEE_MODES.map((mode) => (
                        <FeeModeOption
                          key={mode.value}
                          value={mode.value}
                          label={t(mode.labelKey)}
                          checked={delivery?.deliveryFeeMode === mode.value}
                          disabled={disabled}
                          onChange={(value) => updateDeliveryField("deliveryFeeMode", value)}
                        />
                      ))}
                    </div>
                  </fieldset>
                </div>

                {delivery?.deliveryFeeMode === "FIXED" && (
                  <MoneyField
                    id="delivery-fixed-fee"
                    label={t("config.delivery.fixedFee")}
                    hint={t("config.delivery.fixedFeeHint")}
                    valueCents={delivery.fixedDeliveryFeeCents}
                    disabled={disabled}
                    error={
                      feeErrors.fixedDeliveryFeeCents !== undefined
                        ? t(feeErrors.fixedDeliveryFeeCents)
                        : undefined
                    }
                    onChange={(cents) => updateDeliveryField("fixedDeliveryFeeCents", cents)}
                  />
                )}
                {delivery?.deliveryFeeMode === "MANUAL" && (
                  <MoneyField
                    id="delivery-max-fee"
                    label={t("config.delivery.maxFee")}
                    hint={t("config.delivery.maxFeeHint")}
                    valueCents={delivery.maxDeliveryFeeCents}
                    disabled={disabled}
                    error={
                      feeErrors.maxDeliveryFeeCents !== undefined
                        ? t(feeErrors.maxDeliveryFeeCents)
                        : undefined
                    }
                    onChange={(cents) => updateDeliveryField("maxDeliveryFeeCents", cents)}
                  />
                )}
              </div>
            )}

            {section.id === "receipt" && (
              <div className="divide-y divide-border">
                <ToggleRow
                  id="delivery-print-receipt"
                  label={t("config.delivery.printOnReceipt")}
                  hint={t("config.delivery.printOnReceiptHint")}
                  checked={delivery?.printOnReceipt ?? false}
                  disabled={disabled}
                  onChange={(checked) => updateDeliveryField("printOnReceipt", checked)}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};
