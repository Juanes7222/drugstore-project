/**
 * StrictnessSection — the operation/strictness tab content.
 *
 * Preset selector with 4 preset cards at top, per-toggle controls,
 * custom toggles section, preview and save-as-preset buttons.
 */
import { type FC, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Eye, Bookmark, RotateCcw, Plus, X } from 'lucide-react';
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
    key: 'inventoryAdjustmentReason',
    i18nKey: 'strictness.inventory_adjustment_reason',
    i18nDescKey: 'strictness.inventory_adjustment_reason_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_strict' },
      { value: 'OPTIONAL', i18nLabel: 'strictness.option_optional' },
      { value: 'OFF', i18nLabel: 'strictness.option_off' },
    ],
  },
  {
    key: 'returnsRequireOriginalSale',
    i18nKey: 'strictness.returns_require_original_sale',
    i18nDescKey: 'strictness.returns_require_original_sale_desc',
    type: 'select',
    options: [
      { value: 'STRICT', i18nLabel: 'strictness.option_strict' },
      {
        value: 'WITH_MANAGER_AUTH',
        i18nLabel: 'strictness.option_with_manager_auth',
      },
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
        <h3 className="mb-pos-md text-ui font-semibold text-ink">
          {t('config.presets.title')}
        </h3>
        <div className="grid grid-cols-4 gap-pos-md">
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
            className="pos-button pos-button-secondary mt-pos-md gap-pos-xs"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.1 }}
          >
            <RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" />
            {t('config.presets.reset_all')}
          </motion.button>
        )}

        {/* Active preset description */}
        {currentPreset && (
          <p className="mt-pos-sm text-caption text-ink-muted">
            {currentPreset.description}
          </p>
        )}
      </section>

      {/* ---- Per-toggle strictness list ---- */}
      <section>
        <h3 className="mb-pos-md text-ui font-semibold text-ink">
          {t('config.strictness.title')}
        </h3>
        <div className="space-y-pos-xs">
          {STRICTNESS_FIELDS.map((field, index) => {
            const value = strictness?.[field.key];
            const isOverridden =
              config?.activePresetCode &&
              config.activePresetCode !== 'CUSTOM' &&
              config !== null &&
              domainIsFieldOverridden(config, `strictness.${field.key}`);

            return (
              <motion.div
                key={field.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.02, ease: "easeOut" }}
                className="flex items-center justify-between rounded-sm border border-border bg-panel px-pos-md py-pos-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-pos-sm">
                    <span className="text-body-sm font-medium text-ink">
                      {t('config.' + field.i18nKey)}
                    </span>
                    {isOverridden && (
                      <span className="pos-badge pos-badge-urgency">
                        {t('config.presets.customized')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {t('config.' + field.i18nDescKey)}
                  </p>
                </div>

                <div className="ml-pos-md shrink-0">
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
                      <div className="h-6 w-11 rounded-full bg-surface-variant after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-panel after:transition-all peer-checked:bg-pharma peer-checked:after:translate-x-full peer-focus:outline-2 peer-focus:outline-pharma" />
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
                      className="pos-input w-24 text-right font-data"
                      aria-label={t('config.' + field.i18nKey)}
                    />
                  ) : (
                    <select
                      value={(value as string) ?? ''}
                      onChange={(e) =>
                        handleStrictnessChange(field.key, e.target.value)
                      }
                      disabled={readOnly}
                      className="pos-input"
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
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ---- Custom toggles ---- */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-ui font-semibold text-ink">
            {t('config.custom_toggles.title')}
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setCustomToggleEditorOpen(true)}
              className="pos-button pos-button-primary gap-pos-xs"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
              {t('config.custom_toggles.add')}
            </button>
          )}
        </div>

        {customToggles.length === 0 ? (
          <p className="mt-pos-sm text-body-sm text-ink-muted">
            {t('config.custom_fields.title')} —{' '}
            {readOnly ? t('common.no_permission') : t('config.custom_toggles.add')}
          </p>
        ) : (
          <div className="mt-pos-md space-y-pos-xs">
            {customToggles.map((toggle) => (
              <div
                key={toggle.id}
                className="flex items-center justify-between rounded-sm border border-border bg-panel px-pos-md py-pos-sm"
              >
                <div>
                  <div className="flex items-center gap-pos-sm">
                    <span className="text-body-sm font-medium text-ink">
                      {toggle.name}
                    </span>
                    {toggle.isAdvisory && (
                      <span className="pos-badge pos-badge-restrict">
                        {t('config.custom_toggles.advisory')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {toggle.description}
                  </p>
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {t('config.custom_toggles.applies_to')}: {toggle.appliesTo}
                  </p>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCustomToggle(toggle.id)}
                    className="pos-button pos-button-secondary p-1.5 hover:bg-error-container hover:text-error focus-visible:outline-error"
                    aria-label={`${t('config.custom_fields.remove')} ${toggle.name}`}
                  >
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Preview & Save buttons ---- */}
      <div className="pos-divider pt-4" />
      <div className="flex items-center gap-pos-md">
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="pos-button pos-button-secondary gap-pos-xs"
        >
          <Eye size={14} strokeWidth={1.5} aria-hidden="true" />
          {t('config.preview.title')}
        </button>

        {!readOnly && (
          <button
            type="button"
            className="pos-button pos-button-primary gap-pos-xs"
          >
            <Bookmark size={14} strokeWidth={1.5} aria-hidden="true" />
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
