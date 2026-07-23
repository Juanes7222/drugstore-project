/**
 * PurchasesConfigForm — presentational form for purchase workflow settings.
 * Fields grouped into sections with toggle switches, number inputs, and
 * a save button with transient feedback.
 *
 * @category Component (frontend-pos owns visual polish)
 */

import { useCallback, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Package,
  Building2,
  Loader2,
  Check,
} from 'lucide-react';
import type { PurchasesConfig } from '../../../domain/configuration';

// ── Props contract (owned by pos-local) ─────────────────────────────────

export interface PurchasesConfigFormProps {
  config: PurchasesConfig;
  onChange: (partial: Partial<PurchasesConfig>) => void;
  onSave: () => void;
}

// ── Field definition ────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  labelKey: string;
  hintKey: string;
  type: 'boolean' | 'number';
  min?: number;
}

type SectionId = 'order' | 'reception' | 'supplier';

interface SectionDef {
  id: SectionId;
  titleKey: string;
  icon: FC<{ className?: string; size?: number }>;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    id: 'order',
    titleKey: 'purchases.config.sectionOrder',
    icon: FileText,
    fields: [
      {
        key: 'autoConfirmOnCreate',
        labelKey: 'purchases.config.autoConfirmOnCreate',
        hintKey: 'purchases.config.autoConfirmOnCreateHint',
        type: 'boolean',
      },
      {
        key: 'maxItemsPerOrder',
        labelKey: 'purchases.config.maxItemsPerOrder',
        hintKey: 'purchases.config.maxItemsPerOrderHint',
        type: 'number',
        min: 0,
      },
    ],
  },
  {
    id: 'reception',
    titleKey: 'purchases.config.sectionReception',
    icon: Package,
    fields: [
      {
        key: 'requireLotOnReception',
        labelKey: 'purchases.config.requireLotOnReception',
        hintKey: 'purchases.config.requireLotOnReceptionHint',
        type: 'boolean',
      },
      {
        key: 'requireExpiryOnReception',
        labelKey: 'purchases.config.requireExpiryOnReception',
        hintKey: 'purchases.config.requireExpiryOnReceptionHint',
        type: 'boolean',
      },
      {
        key: 'allowOverReception',
        labelKey: 'purchases.config.allowOverReception',
        hintKey: 'purchases.config.allowOverReceptionHint',
        type: 'boolean',
      },
    ],
  },
  {
    id: 'supplier',
    titleKey: 'purchases.config.sectionSupplier',
    icon: Building2,
    fields: [
      {
        key: 'defaultPaymentTermsDays',
        labelKey: 'purchases.config.defaultPaymentTermsDays',
        hintKey: 'purchases.config.defaultPaymentTermsDaysHint',
        type: 'number',
        min: 0,
      },
    ],
  },
];

// ── Save button states ──────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved';

// ── Toggle switch subcomponent ──────────────────────────────────────────

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const ToggleSwitch: FC<ToggleSwitchProps> = ({
  id,
  checked,
  onChange,
  disabled = false,
}) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!disabled) onChange(!checked);
      }
    },
    [checked, disabled, onChange],
  );

  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      id={id}
      onKeyDown={handleKeyDown}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
        'transition-colors duration-200 ease-in-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma',
        checked
          ? 'bg-pharma'
          : 'bg-ink/15 hover:bg-ink/25',
        disabled && 'cursor-not-allowed opacity-50',
      ].join(' ')}
    >
      <span
          aria-hidden="true"
          className={[
            'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-pos-panel',
            'transition-transform duration-200 ease-in-out',
            checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
          ].join(' ')}
        />
    </div>
  );
};

// ── Component ───────────────────────────────────────────────────────────

export const PurchasesConfigForm: FC<PurchasesConfigFormProps> = ({
  config,
  onChange,
  onSave,
}) => {
  const { t } = useTranslation();
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const handleToggle = useCallback(
    (key: string) => (checked: boolean) => {
      onChange({ [key]: checked } as Partial<PurchasesConfig>);
    },
    [onChange],
  );

  const handleNumberChange = useCallback(
    (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const value = raw === '' ? 0 : Number(raw);
      onChange({ [key]: value } as Partial<PurchasesConfig>);
    },
    [onChange],
  );

  const handleSave = useCallback(() => {
    setSaveState('saving');
    onSave();
    // Brief success feedback – parent handles actual persistence
    setTimeout(() => setSaveState('saved'), 400);
    setTimeout(() => setSaveState('idle'), 2400);
  }, [onSave]);

  const renderToggleField = (field: FieldDef) => {
    const key = field.key as keyof PurchasesConfig;
    const checked = config[key] as boolean;
    return (
      <div key={field.key} className="flex items-start gap-3">
        <ToggleSwitch
          id={field.key}
          checked={checked}
          onChange={handleToggle(field.key)}
        />
        <div className="flex-1 min-w-0">
          <label
            htmlFor={field.key}
            className="text-sm font-medium text-ink cursor-pointer select-none"
          >
            {t(field.labelKey)}
          </label>
          <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
            {t(field.hintKey)}
          </p>
        </div>
      </div>
    );
  };

  const renderNumberField = (field: FieldDef) => {
    const key = field.key as keyof PurchasesConfig;
    const numValue = config[key] as number;
    return (
      <div key={field.key} className="flex flex-col gap-1">
        <label htmlFor={field.key} className="text-sm font-medium text-ink">
          {t(field.labelKey)}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            id={field.key}
            value={numValue}
            onChange={handleNumberChange(field.key)}
            min={field.min}
            className={[
              'w-24 px-3 py-1.5',
              'text-sm font-data text-ink text-right',
              'border border-border rounded-pos bg-panel',
              'transition-colors duration-150',
              'hover:border-ink/30',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma',
            ].join(' ')}
          />
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          {t(field.hintKey)}
        </p>
      </div>
    );
  };

  const renderField = (field: FieldDef) => {
    return field.type === 'boolean'
      ? renderToggleField(field)
      : renderNumberField(field);
  };

  return (
    <div className="space-y-6 max-w-xl">
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <section
            key={section.id}
            className="bg-panel rounded-pos shadow-pos-panel overflow-hidden"
          >
            {/* Section header */}
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <Icon
                size={16}
                className="text-pharma shrink-0"
                aria-hidden="true"
              />
              <h3 className="text-sm font-semibold text-ink uppercase tracking-wider">
                {t(section.titleKey)}
              </h3>
            </div>

            {/* Fields */}
            <div className="px-4 pb-4 space-y-4">
              {section.fields.map((field) => (
                <div
                  key={field.key}
                  className={[
                    'rounded-pos p-3',
                    'transition-colors duration-150',
                    'hover:bg-surface/60',
                    'focus-within:bg-surface/60',
                  ].join(' ')}
                >
                  {renderField(field)}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* Save button */}
      <div className="pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveState !== 'idle'}
          className={[
            'pos-button pos-button-primary text-sm min-w-[160px]',
            'transition-all duration-200',
            saveState === 'saved' && '!bg-success',
          ].join(' ')}
        >
          {saveState === 'idle' && t('purchases.config.save')}
          {saveState === 'saving' && (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              {t('common.saving')}
            </span>
          )}
          {saveState === 'saved' && (
            <span className="inline-flex items-center gap-2">
              <Check size={14} aria-hidden="true" />
              {t('purchases.config.saved')}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
