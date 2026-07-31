/**
 * PurchasesConfigTab — purchase workflow settings for the tenant config page.
 *
 * Reads from tenant config store (with fallback to local config store).
 * Writes to server via ConfigService + local config store for immediate UI.
 * Follows the section-header + card pattern of other config tabs.
 *
 * @category Config Tab
 */

import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2Icon, CheckCircleIcon, PackageCheckIcon, ShoppingCartIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import {
  useLocalConfigStore,
} from '../../../domain/configuration';
import type { PurchasesConfig } from '../../../domain/configuration';
import { useTenantConfig } from '../../../domain/config/use-tenant-config';
import { useTenantConfigStore } from '../../../domain/config/tenant-config.store';
import { getPresetPurchases } from '../../../domain/config/presets';
import { DEFAULT_PURCHASES } from '../../../domain/config/defaults';

// ── Section definitions ─────────────────────────────────────────────────

interface FieldDef {
  key: keyof PurchasesConfig;
  labelKey: string;
  hintKey: string;
  type: 'boolean' | 'number';
  min?: number;
}

interface SectionDef {
  id: string;
  icon: IconComponent;
  titleKey: string;
  fields: FieldDef[];
}

const ORDER_FIELDS: FieldDef[] = [
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
];

const RECEPTION_FIELDS: FieldDef[] = [
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
];

const SUPPLIER_FIELDS: FieldDef[] = [
  {
    key: 'defaultPaymentTermsDays',
    labelKey: 'purchases.config.defaultPaymentTermsDays',
    hintKey: 'purchases.config.defaultPaymentTermsDaysHint',
    type: 'number',
    min: 0,
  },
];

const SECTIONS: SectionDef[] = [
  {
    id: 'orders',
    icon: ShoppingCartIcon,
    titleKey: 'purchases.config.sectionOrder',
    fields: ORDER_FIELDS,
  },
  {
    id: 'reception',
    icon: PackageCheckIcon,
    titleKey: 'purchases.config.sectionReception',
    fields: RECEPTION_FIELDS,
  },
  {
    id: 'supplier',
    icon: Building2Icon,
    titleKey: 'purchases.config.sectionSupplier',
    fields: SUPPLIER_FIELDS,
  },
];

// ── Helper components ───────────────────────────────────────────────────

const ToggleSwitch: FC<{
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, checked, onChange }) => {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
        border-2 border-transparent transition-colors duration-200
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma
        ${checked ? 'bg-pharma' : 'bg-border'}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200
          ${checked ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </button>
  );
};

// ── Tab component ───────────────────────────────────────────────────────

export const PurchasesConfigTab: FC = () => {
  const { t } = useTranslation();
  const { config: tenantConfig, update } = useTenantConfig();
  const storePurchases = tenantConfig?.purchases;
  const presetCode = tenantConfig?.activePresetCode;

  // Tracks whether the user has an in-flight change.
  // Prevents the store-sync effect from overriding user edits.
  const dirtyRef = useRef(false);

  // Derive display purchases by merging:
  //   1. Safe defaults (all fields populated)
  //   2. Local preset defaults (match current operation mode)
  //   3. Server-stored purchases (user's saved overrides)
  // This ensures the tab shows correct values even when the server
  // returns an empty {} for purchases (e.g., before first save).
  const computePurchases = useCallback(
    (store: PurchasesConfig | undefined): PurchasesConfig => ({
      ...DEFAULT_PURCHASES,
      ...(presetCode ? getPresetPurchases(presetCode) : {}),
      ...store,
    }),
    [presetCode],
  );

  const [config, setConfig] = useState<PurchasesConfig>(() =>
    computePurchases(storePurchases),
  );

  // Sync store → local state when purchases change externally
  // (e.g., a different tab applied a preset). Only sync when the
  // user has no pending local change (dirtyRef = false).
  useEffect(() => {
    if (!dirtyRef.current) {
      setConfig(computePurchases(storePurchases));
    }
  }, [storePurchases, computePurchases]);

  const handleChange = useCallback(
    (partial: Partial<PurchasesConfig>) => {
      dirtyRef.current = true;
      // Optimistic UI update
      setConfig((prev) => ({ ...prev, ...partial }));
      // Keep local config store in sync for backward compat
      useLocalConfigStore.getState().updatePurchasesConfig(partial);
      // Fire-and-forget persist to server
      const tenantConfig = useTenantConfigStore.getState().config;
      if (tenantConfig) {
        const purchases = { ...tenantConfig.purchases, ...partial };
        update({ purchases })
          .then(() => {
            // Server confirmed — allow store-sync again
            dirtyRef.current = false;
          })
          .catch(() => {
            // Swallow server errors — POS keeps the optimistic local change.
            dirtyRef.current = false;
          });
      } else {
        dirtyRef.current = false;
      }
    },
    [update],
  );

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-body-sm text-ink-muted">
          {t('purchases.config.description')}
        </p>
        <span className="inline-flex items-center gap-1.5 text-body-xs text-ink-muted">
          <CheckCircleIcon size={12} aria-hidden="true" strokeWidth={1.5} />
          {t('purchases.config.autoSave')}
        </span>
      </div>

      {/* Sections */}
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <section key={section.id} className="rounded-sm bg-panel shadow-pos-panel">
            {/* Section header */}
            <div className="flex items-center gap-2 border-b border-border px-pos-xl py-pos-md">
              <Icon size={18} strokeWidth={1.5} className="text-pharma" aria-hidden="true" />
              <h3 className="text-ui font-medium text-ink">
                {t(section.titleKey)}
              </h3>
            </div>

            {/* Section fields */}
            <div className="divide-y divide-border">
              {section.fields.map((field) => (
                <div
                  key={field.key}
                  className="flex items-start gap-4 px-pos-xl py-pos-md hover:bg-surface/40 transition-colors"
                >
                  {field.type === 'boolean' ? (
                    <>
                      <div className="flex-1 min-w-0">
                        <label
                          htmlFor={field.key}
                          className="text-body-sm font-medium text-ink cursor-pointer"
                        >
                          {t(field.labelKey)}
                        </label>
                        <p className="text-body-xs text-ink-muted mt-0.5">
                          {t(field.hintKey)}
                        </p>
                      </div>
                      <ToggleSwitch
                        id={field.key}
                        checked={config[field.key] as boolean}
                        onChange={(checked) => handleChange({ [field.key]: checked } as Partial<PurchasesConfig>)}
                      />
                    </>
                  ) : (
                    <div className="flex flex-col gap-1 flex-1">
                      <label
                        htmlFor={field.key}
                        className="text-body-sm font-medium text-ink"
                      >
                        {t(field.labelKey)}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          id={field.key}
                          value={config[field.key] as number}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const value = raw === '' ? 0 : Number(raw);
                            handleChange({ [field.key]: value } as Partial<PurchasesConfig>);
                          }}
                          min={field.min}
                          className="w-24 rounded border border-border bg-surface px-3 py-1.5 text-body-sm text-ink
                            transition-colors hover:border-pharma/50 focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma"
                        />
                        <span className="text-body-xs text-ink-muted">
                          {t(field.hintKey)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
