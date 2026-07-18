/**
 * StrictnessSection — the operation/strictness tab content.
 *
 * Preset selector with 4 preset cards at top, per-toggle controls,
 * custom toggles section, preview and save-as-preset buttons.
 */
import { type FC, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import {
  useTenantConfig,
  PRESET_LIST,
  isFieldOverridden as domainIsFieldOverridden,
  type StrictnessConfig,
  type CustomCompanyField,
  type CustomStrictnessToggle,
  type PresetCode,
} from '../../../domain/config';
import { PresetCard } from './preset-card';
import { CustomFieldEditor } from './custom-field-editor';
import { ConfigPreviewModal } from './config-preview-modal';

// ---------------------------------------------------------------------------
// Strictness field descriptors
// ---------------------------------------------------------------------------

interface StrictnessField {
  key: keyof StrictnessConfig;
  i18nKey: string;
  i18nDescKey: string;
  type: 'select' | 'number' | 'boolean';
  options?: Array<{ value: string; i18nLabel: string }>;
}

const STRICTNESS_FIELDS: StrictnessField[] = [
  {
    key: 'lots',
    i18nKey: 'strictness.lots',
    i18nDescKey: 'strictness.lots_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_strict' },
      { value: 'OPTIONAL', i18nLabel: 'strictness.option_optional' },
      { value: 'OFF', i18nLabel: 'strictness.option_off' },
    ],
  },
  {
    key: 'expiryDates',
    i18nKey: 'strictness.expiry_dates',
    i18nDescKey: 'strictness.expiry_dates_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_strict' },
      { value: 'OPTIONAL', i18nLabel: 'strictness.option_optional' },
      { value: 'OFF', i18nLabel: 'strictness.option_off' },
    ],
  },
  {
    key: 'stockValidation',
    i18nKey: 'strictness.stock_validation',
    i18nDescKey: 'strictness.stock_validation_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_block' },
      { value: 'WARN', i18nLabel: 'strictness.option_warn' },
      { value: 'OFF', i18nLabel: 'strictness.option_off' },
    ],
  },
  {
    key: 'clientRequired',
    i18nKey: 'strictness.client_required',
    i18nDescKey: 'strictness.client_required_desc',
    type: 'select',
    options: [
      { value: 'ALWAYS', i18nLabel: 'strictness.option_always' },
      { value: 'ABOVE_AMOUNT', i18nLabel: 'strictness.option_above_amount' },
      { value: 'NEVER', i18nLabel: 'strictness.option_never' },
    ],
  },
  {
    key: 'clientRequiredThreshold',
    i18nKey: 'strictness.client_required_threshold',
    i18nDescKey: 'strictness.client_required_threshold_desc',
    type: 'number',
  },
  {
    key: 'prescriptionEnforcement',
    i18nKey: 'strictness.prescription_enforcement',
    i18nDescKey: 'strictness.prescription_enforcement_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_block' },
      { value: 'WARN', i18nLabel: 'strictness.option_warn' },
      { value: 'OFF', i18nLabel: 'strictness.option_off' },
    ],
  },
  {
    key: 'inventoryAdjustmentReason',
    i18nKey: 'strictness.inventory_adjustment_reason',
    i18nDescKey: 'strictness.inventory_adjustment_reason_desc',
    type: 'select',
    options: [
      { value: 'REQUIRED', i18nLabel: 'strictness.option_required' },
      { value: 'OPTIONAL', i18nLabel: 'strictness.option_optional' },
    ],
  },
  {
    key: 'returnsRequireOriginalSale',
    i18nKey: 'strictness.returns_require_original_sale',
    i18nDescKey: 'strictness.returns_require_original_sale_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_strict' },
      { value: 'OPTIONAL', i18nLabel: 'strictness.option_optional' },
      { value: 'OFF', i18nLabel: 'strictness.option_off' },
    ],
  },
  {
    key: 'cashShiftRequired',
    i18nKey: 'strictness.cash_shift_required',
    i18nDescKey: 'strictness.cash_shift_required_desc',
    type: 'boolean',
  },
  {
    key: 'receiptPrintRequired',
    i18nKey: 'strictness.receipt_print_required',
    i18nDescKey: 'strictness.receipt_print_required_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_strict' },
      { value: 'OPTIONAL', i18nLabel: 'strictness.option_optional' },
      { value: 'OFF', i18nLabel: 'strictness.option_off' },
    ],
  },
  {
    key: 'autoOpenDrawer',
    i18nKey: 'strictness.auto_open_drawer',
    i18nDescKey: 'strictness.auto_open_drawer_desc',
    type: 'select',
    options: [
      { value: 'ALWAYS', i18nLabel: 'strictness.option_always' },
      { value: 'CASH_ONLY', i18nLabel: 'strictness.option_cash_only' },
      { value: 'MANUAL', i18nLabel: 'strictness.option_manual' },
    ],
  },
  {
    key: 'customerDisplayRequired',
    i18nKey: 'strictness.customer_display_required',
    i18nDescKey: 'strictness.customer_display_required_desc',
    type: 'boolean',
  },
  {
    key: 'prescriptionExpiryDays',
    i18nKey: 'strictness.prescription_expiry_days',
    i18nDescKey: 'strictness.prescription_expiry_days_desc',
    type: 'number',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface StrictnessSectionProps {
  /** If true, disallows editing. */
  readOnly?: boolean;
}

export const StrictnessSection: FC<StrictnessSectionProps> = ({
  readOnly = false,
}) => {
  const { t } = useTranslation();
  const {
    config,
    effectiveConfig,
    isCustomized,
    applyPreset,
    update,
    addCustomToggle,
    removeCustomToggle,
  } = useTenantConfig();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [customToggleEditorOpen, setCustomToggleEditorOpen] = useState(false);

  // ---- Handlers ----

  const handlePresetSelect = useCallback(
    async (code: string) => {
      if (readOnly) return;
      await applyPreset(code as PresetCode);
    },
    [applyPreset, readOnly],
  );

  const handleStrictnessChange = useCallback(
    async (key: string, value: string | number | boolean) => {
      if (readOnly || !config) return;
      // Send the full strictness section — preserves all fields for
      // cross-field validation (e.g. clientRequired + threshold).
      await update({
        strictness: { ...config.strictness, [key]: value },
      });
    },
    [config, update, readOnly],
  );

  const handleSaveCustomToggle = useCallback(
    async (data: CustomCompanyField | CustomStrictnessToggle) => {
      if ('defaultValue' in data) {
        await addCustomToggle(data as CustomStrictnessToggle);
      }
    },
    [addCustomToggle],
  );

  const handleRemoveCustomToggle = useCallback(
    async (id: string) => {
      await removeCustomToggle(id);
    },
    [removeCustomToggle],
  );

  const handleResetToPreset = useCallback(async () => {
    if (readOnly) return;
    if (!config?.activePresetCode) return;
    await applyPreset(config.activePresetCode as PresetCode);
  }, [config, applyPreset, readOnly]);

  // ---- Derived state ----

  const activePresetCode = effectiveConfig?.activePresetCode ?? 'CUSTOM';
  const strictness = effectiveConfig?.strictness;
  const customToggles = effectiveConfig?.customStrictnessToggles ?? [];

  const currentPreset = useMemo(
    () => PRESET_LIST.find((p) => p.code === activePresetCode),
    [activePresetCode],
  );

  return (
    <div className="space-y-8">
      {/* ---- Preset selector ---- */}
      <section>
        <h3 className="mb-4 text-base font-semibold text-ink dark:text-gray-100">
          {t('config.presets.title')}
        </h3>
        <div className="grid grid-cols-4 gap-3">
          {PRESET_LIST.map((preset) => (
            <PresetCard
              key={preset.code}
              preset={preset}
              isActive={activePresetCode === preset.code}
              isCustomized={isCustomized}
              onSelect={handlePresetSelect}
              disabled={readOnly}
            />
          ))}
        </div>

        {/* Reset to preset button */}
        {isCustomized && !readOnly && (
          <motion.button
            type="button"
            onClick={handleResetToPreset}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-pharma hover:text-pharma/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma dark:text-pharma dark:hover:text-pharma/80"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.1 }}
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
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            {t('config.presets.reset_all')}
          </motion.button>
        )}

        {/* Active preset description */}
        {currentPreset && (
          <p className="mt-2 text-xs text-ink-muted dark:text-gray-400">
            {currentPreset.description}
          </p>
        )}
      </section>

      {/* ---- Per-toggle strictness list ---- */}
      <section>
        <h3 className="mb-4 text-base font-semibold text-ink dark:text-gray-100">
          {t('config.strictness.title')}
        </h3>
        <div className="space-y-3">
          {STRICTNESS_FIELDS.map((field) => {
            const value = strictness?.[field.key];
            const isOverridden =
              config?.activePresetCode &&
              config.activePresetCode !== 'CUSTOM' &&
              config !== null &&
              domainIsFieldOverridden(config, `strictness.${field.key}`);

            return (
              <div
                key={field.key}
                className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink dark:text-gray-100">
                      {t('config.' + field.i18nKey)}
                    </span>
                    {isOverridden && (
                      <span className="inline-flex items-center rounded-full bg-urgency-surface px-2 py-0.5 text-xs font-medium text-urgency
dark:bg-amber-900/30 dark:text-urgency">
                        {t('config.presets.customized')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted dark:text-gray-400">
                    {t('config.' + field.i18nDescKey)}
                  </p>
                </div>

                <div className="ml-4">
                  {field.type === 'boolean' ? (
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={!!value}
                        onChange={(e) =>
                          handleStrictnessChange(field.key, e.target.checked)
                        }
                        disabled={readOnly}
                        className="peer sr-only"
                        aria-label={t('config.' + field.i18nKey)}
                      />
                      <div className="h-6 w-11 rounded-full bg-surface-variant after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-panel after:transition-all peer-checked:bg-pharma peer-checked:after:translate-x-full peer-focus:outline-2 peer-focus:outline-pharma dark:bg-gray-600 dark:after:bg-gray-300" />
                    </label>
                  ) : field.type === 'number' ? (
                    <input
                      type="number"
                      value={(value as number) ?? 0}
                      onChange={(e) =>
                        handleStrictnessChange(
                          field.key,
                          parseInt(e.target.value, 10) || 0,
                        )
                      }
                      disabled={readOnly}
                      className="w-24 rounded-lg border border-border px-3 py-1.5 text-sm text-right focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      aria-label={t('config.' + field.i18nKey)}
                    />
                  ) : (
                    <select
                      value={(value as string) ?? ''}
                      onChange={(e) =>
                        handleStrictnessChange(field.key, e.target.value)
                      }
                      disabled={readOnly}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      aria-label={t('config.' + field.i18nKey)}
                    >
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t('config.' + opt.i18nLabel)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Custom toggles ---- */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink dark:text-gray-100">
            {t('config.custom_toggles.title')}
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setCustomToggleEditorOpen(true)}
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
              {t('config.custom_toggles.add')}
            </button>
          )}
        </div>

        {customToggles.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted dark:text-gray-400">
            {t('config.custom_fields.title')} —{' '}
            {readOnly ? t('common.no_permission') : t('config.custom_toggles.add')}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {customToggles.map((toggle) => (
              <div
                key={toggle.id}
                className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink dark:text-gray-100">
                      {toggle.name}
                    </span>
                    {toggle.isAdvisory && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                        {t('config.custom_toggles.advisory')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted dark:text-gray-400">
                    {toggle.description}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t('config.custom_toggles.applies_to')}: {toggle.appliesTo}
                  </p>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCustomToggle(toggle.id)}
                    className="ml-4 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-error-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error dark:hover:bg-red-900/20"
                    aria-label={`${t('config.custom_fields.remove')} ${toggle.name}`}
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
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Preview & Save buttons ---- */}
      <div className="flex items-center gap-3 border-t border-border pt-4 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-variant focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
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
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {t('config.preview.title')}
        </button>

        {!readOnly && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-pharma px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pharma/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
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
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            {t('config.named_presets.save')}
          </button>
        )}
      </div>

      {/* ---- Modals ---- */}
      <ConfigPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        effectiveConfig={effectiveConfig}
      />

      <CustomFieldEditor
        open={customToggleEditorOpen}
        onOpenChange={setCustomToggleEditorOpen}
        mode={{ kind: 'toggle' }}
        onSave={handleSaveCustomToggle}
      />
    </div>
  );
};


