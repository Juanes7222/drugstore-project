/**
 * SalesConfigTab — per-role sales configuration (discount limits, price
 * override permissions, cost floor).
 *
 * Reads from `useLocalConfigStore` for both `discountLimits` and `salesConfig`.
 * Writes through the same store: `updateSalesConfig` for the price-override
 * and floor blocks, and `hydrateFromServer` for `discountLimits` (the only
 * available write path for that block in the current store API).
 *
 * Persistence round-trip: the store is applied optimistically, then PUSHED to
 * `PUT /configuration/pos-settings/sales` (OWNER only), which writes the
 * `POS_DISCOUNT_LIMITS` and `POS_SALES_CONFIG` SystemConfig keys for the whole
 * pharmacy.
 *
 * Previously there was no push at all: these blocks were workstation-local and
 * were silently reverted by the next sync cycle, which pulls these same keys.
 * A failed push now restores the previous values and raises an error rather
 * than leaving a value on screen that looks saved but is not — the next boot
 * would quietly discard it, which is the failure this tab used to have.
 *
 * Follows the section-header + card pattern of `purchases-config-tab.tsx`.
 *
 * @category Config Tab
 */

import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, CreditCardIcon, PercentIcon, ShieldIcon, TagIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { useClientsService } from "@/components/common/service-context";
import { notify } from '@/utils/notify';
import { useConfigService } from '../../../domain/config';
import {
  useLocalConfigStore,
  DEFAULT_CREDIT_LIMIT_CENTS,
  type DiscountLimitRole,
  type DiscountLimits,
  type PriceFloorType,
  type SalesConfig,
} from '../../../domain/configuration';

/**
 * Debounce before backfilling the default credit limit onto existing
 * clients, so typing the limit never triggers a flood of writes.
 */
const CREDIT_BACKFILL_DEBOUNCE_MS = 600;

/**
 * Debounce before pushing the sales settings to the server.
 *
 * Same reasoning as the credit backfill, and it matters more here: every
 * keystroke in a percentage field would otherwise be a write to shared,
 * pharmacy-wide configuration that other workstations boot from.
 */
const SALES_SETTINGS_PUSH_DEBOUNCE_MS = 600;

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
    id: 'discounts',
    Icon: PercentIcon,
    titleKey: 'config.sales.sectionDiscounts',
    descKey: 'config.sales.sectionDiscountsDesc',
  },
  {
    id: 'overrides',
    Icon: TagIcon,
    titleKey: 'config.sales.sectionOverrides',
    descKey: 'config.sales.sectionOverridesDesc',
  },
  {
    id: 'floor',
    Icon: ShieldIcon,
    titleKey: 'config.sales.sectionFloor',
    descKey: 'config.sales.sectionFloorDesc',
  },
  {
    id: 'credit',
    Icon: CreditCardIcon,
    titleKey: 'config.sales.sectionCredit',
    descKey: 'config.sales.sectionCreditDesc',
  },
];

// Roles shown in the discount limits table. Owner is read-only and rendered
// with an informational note; the others are editable.
const DISCOUNT_ROLES: DiscountLimitRole[] = [
  'manager',
  'cashier',
  'inventoryAssistant',
  'accountant',
];

// Roles shown in the price-override table. Owner is intentionally absent
// here — owners are implicitly allowed to override any price (subject only
// to the cost floor) per the data-model documentation.
const OVERRIDE_ROLES: Array<{
  key: keyof SalesConfig['priceOverridePermissions'];
  i18nKey: string;
}> = [
  { key: 'manager', i18nKey: 'config.sales.roleManager' },
  { key: 'cashier', i18nKey: 'config.sales.roleCashier' },
  { key: 'inventoryAssistant', i18nKey: 'config.sales.roleInventoryAssistant' },
  { key: 'accountant', i18nKey: 'config.sales.roleAccountant' },
];

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

// ---------------------------------------------------------------------------
// Tab component
// ---------------------------------------------------------------------------

export const SalesConfigTab: FC = () => {
  const { t } = useTranslation();
  const configService = useConfigService();

  // Subscribe to the slice of the store we care about. Reading via
  // useLocalConfigStore.subscribe keeps the component reactive to both the
  // salesConfig and discountLimits blocks.
  const [salesConfig, setSalesConfigState] = useState<SalesConfig>(
    () => useLocalConfigStore.getState().salesConfig,
  );
  const [discountLimits, setDiscountLimitsState] = useState<DiscountLimits>(
    () => useLocalConfigStore.getState().discountLimits,
  );

  useEffect(() => {
    const unsub = useLocalConfigStore.subscribe((state) => {
      setSalesConfigState(state.salesConfig);
      setDiscountLimitsState(state.discountLimits);
    });
    return unsub;
  }, []);

  // ---- Store-credit backfill ----
  // Whenever credit is enabled with a positive default limit, apply that
  // limit to existing clients that don't have one yet (idempotent — only
  // null-limit clients are touched). Debounced so typing the limit does
  // not fire a write per keystroke.
  const clientsService = useClientsService();
  const lastBackfill = useRef<{
    creditEnabled: boolean;
    defaultCreditLimitCents: number;
  } | null>(null);

  useEffect(() => {
    const { creditEnabled, defaultCreditLimitCents } = salesConfig;
    if (!creditEnabled || defaultCreditLimitCents <= 0) {
      lastBackfill.current = null;
      return;
    }

    const last = lastBackfill.current;
    if (
      last &&
      last.creditEnabled === creditEnabled &&
      last.defaultCreditLimitCents === defaultCreditLimitCents
    ) {
      return;
    }
    lastBackfill.current = { creditEnabled, defaultCreditLimitCents };

    const handle = window.setTimeout(() => {
      void clientsService
        .applyDefaultCreditToClients()
        .then(() => {
          // Only remember the applied values once the backfill succeeded,
          // so a transient failure is retried on the next config change.
          lastBackfill.current = {
            creditEnabled,
            defaultCreditLimitCents,
          };
        })
        .catch((err: unknown) => {
          console.error('[SalesConfigTab] credit backfill failed:', err);
        });
    }, CREDIT_BACKFILL_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [salesConfig.creditEnabled, salesConfig.defaultCreditLimitCents, clientsService]);

  // ---- Mutations ----

  // ---- Push to the server ----

  /**
   * Last state the server is known to hold.
   *
   * Kept as a ref rather than state: it is only read inside an async
   * continuation, and re-rendering on every keystroke to track it would defeat
   * the point. Seeded once from the store, then advanced only after a
   * successful push — so a failed push restores the server's truth, not
   * whatever the user happened to have typed a moment earlier.
   */
  const confirmedRef = useRef<{
    discountLimits: DiscountLimits;
    salesConfig: SalesConfig;
  } | null>(null);

  const pushTimer = useRef<number | null>(null);

  if (confirmedRef.current === null) {
    confirmedRef.current = {
      discountLimits: useLocalConfigStore.getState().discountLimits,
      salesConfig: useLocalConfigStore.getState().salesConfig,
    };
  }

  const restoreConfirmed = useCallback(() => {
    const confirmed = confirmedRef.current;
    if (!confirmed) return;
    useLocalConfigStore.getState().hydrateFromServer({
      discountLimits: confirmed.discountLimits,
      alertThresholds: useLocalConfigStore.getState().alertThresholds,
      syncDefaults: useLocalConfigStore.getState().syncDefaults,
      salesConfig: confirmed.salesConfig,
      sellerInfo: useLocalConfigStore.getState().sellerInfo,
      purchasesConfig: useLocalConfigStore.getState().purchasesConfig,
    });
  }, []);

  const pushNow = useCallback(() => {
    const current = useLocalConfigStore.getState();
    const payload = {
      discountLimits: current.discountLimits,
      salesConfig: current.salesConfig,
    };

    void configService
      .updateSalesSettings(payload)
      .then(() => {
        confirmedRef.current = payload;
      })
      .catch((err: unknown) => {
        console.error('[SalesConfigTab] saving sales settings failed:', err);
        // Put the server's value back on screen. Leaving the failed value
        // would show a setting that was never stored anywhere and that the
        // next sync pull silently reverts — the user would have no way to
        // tell it did not save.
        restoreConfirmed();
        notify.error({ title: t('config.errors.save_failed') });
      });
  }, [configService, restoreConfirmed, t]);

  const schedulePush = useCallback(() => {
    if (pushTimer.current !== null) {
      window.clearTimeout(pushTimer.current);
    }
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      pushNow();
    }, SALES_SETTINGS_PUSH_DEBOUNCE_MS);
  }, [pushNow]);

  /**
   * Flush a pending push when the tab goes away.
   *
   * Deliberately NOT cancelled: the tab unmounts every time the owner clicks
   * away to another settings tab, and a discarded timer would silently drop the
   * edit — the value would sit in the local store looking saved, reach no other
   * workstation, and be reverted by the next boot pull. Firing on unmount
   * closes that window; if the app is genuinely shutting down the request may
   * not land, but nothing was previously queued to cover that case either.
   */
  useEffect(
    () => () => {
      if (pushTimer.current !== null) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
        pushNow();
      }
    },
    [pushNow],
  );

  const updateDiscountRoleLimit = useCallback(
    (
      role: DiscountLimitRole,
      key: 'itemMaxPercent' | 'globalMaxPercent',
      value: number,
    ) => {
      // discountLimits has no dedicated mutator in the store today, so we
      // round-trip through hydrateFromServer with the full payload composed
      // from the current store state. Other blocks (alertThresholds,
      // syncDefaults, sellerInfo, purchasesConfig) are passed through
      // unchanged so this only mutates the targeted role.
      const state = useLocalConfigStore.getState();
      useLocalConfigStore.getState().hydrateFromServer({
        discountLimits: {
          ...state.discountLimits,
          [role]: {
            ...state.discountLimits[role],
            [key]: value,
          },
        },
        alertThresholds: state.alertThresholds,
        syncDefaults: state.syncDefaults,
        salesConfig: state.salesConfig,
        sellerInfo: state.sellerInfo,
        purchasesConfig: state.purchasesConfig,
      });
      schedulePush();
    },
    [schedulePush],
  );

  const updateOverride = useCallback(
    (
      role: keyof SalesConfig['priceOverridePermissions'],
      key: 'allowed' | 'requireReason',
      value: boolean,
    ) => {
      const current = useLocalConfigStore.getState().salesConfig;
      useLocalConfigStore.getState().updateSalesConfig({
        priceOverridePermissions: {
          ...current.priceOverridePermissions,
          [role]: {
            ...current.priceOverridePermissions[role],
            [key]: value,
          },
        },
      });
      schedulePush();
    },
    [schedulePush],
  );

  const updateFloor = useCallback(
    (partial: Partial<SalesConfig['priceFloor']>) => {
      const current = useLocalConfigStore.getState().salesConfig;
      useLocalConfigStore.getState().updateSalesConfig({
        priceFloor: {
          ...current.priceFloor,
          ...partial,
        },
      });
      schedulePush();
    },
    [schedulePush],
  );

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-body-sm text-ink-muted">
          {t('config.sales.description')}
        </p>
        <span className="inline-flex items-center gap-1.5 text-body-xs text-ink-muted">
          <CheckCircleIcon size={12} aria-hidden="true" strokeWidth={1.5} />
          {t('config.sales.autoSave')}
        </span>
      </div>

      {SECTIONS.map((section) => {
        const SectionIcon = section.Icon;
        return (
          <section
            key={section.id}
            className="rounded-sm bg-panel shadow-pos-panel"
            aria-labelledby={`sales-section-${section.id}-title`}
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
                id={`sales-section-${section.id}-title`}
                className="text-ui font-medium text-ink"
              >
                {t(section.titleKey)}
              </h3>
            </div>
            <p className="px-pos-xl py-pos-sm text-body-xs text-ink-muted">
              {t(section.descKey)}
            </p>

            {/* Section body — different shape per section */}
            {section.id === 'discounts' && (
              <DiscountLimitsBody
                limits={discountLimits}
                onChange={updateDiscountRoleLimit}
              />
            )}
            {section.id === 'overrides' && (
              <OverridesBody
                permissions={salesConfig.priceOverridePermissions}
                onChange={updateOverride}
              />
            )}
            {section.id === 'floor' && (
              <FloorBody
                floor={salesConfig.priceFloor}
                onChange={updateFloor}
              />
            )}
            {section.id === 'credit' && (
              <CreditBody
                creditEnabled={salesConfig.creditEnabled}
                defaultCreditLimitCents={salesConfig.defaultCreditLimitCents}
                onEnabledChange={(enabled) => {
                  const current = useLocalConfigStore.getState().salesConfig;
                  useLocalConfigStore.getState().updateSalesConfig({
                    creditEnabled: enabled,
                    // Activating credit always leaves a usable default
                    // limit behind, so existing clients are not activated
                    // with a $0 (disabled) limit.
                    defaultCreditLimitCents:
                      enabled && current.defaultCreditLimitCents <= 0
                        ? DEFAULT_CREDIT_LIMIT_CENTS
                        : current.defaultCreditLimitCents,
                  });
                  schedulePush();
                }}
                onDefaultLimitChange={(defaultCreditLimitCents) => {
                  useLocalConfigStore.getState().updateSalesConfig({
                    defaultCreditLimitCents,
                  });
                  schedulePush();
                }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section 1 — Discount limits
// ---------------------------------------------------------------------------

interface DiscountLimitsBodyProps {
  limits: DiscountLimits;
  onChange: (
    role: DiscountLimitRole,
    key: 'itemMaxPercent' | 'globalMaxPercent',
    value: number,
  ) => void;
}

const DiscountLimitsBody: FC<DiscountLimitsBodyProps> = ({
  limits,
  onChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="divide-y divide-border">
      {/* Owner row — read-only informational */}
      <div className="px-pos-xl py-pos-md">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <span className="text-body-sm font-medium text-ink-muted">
              {t('config.sales.roleOwner')}
            </span>
            <p className="mt-0.5 text-body-xs text-ink-muted">
              {t('config.sales.ownerExemptNote')}
            </p>
          </div>
          <div
            className="flex items-center gap-3 font-data text-body-sm text-ink-muted tabular-nums"
            aria-label={`${t('config.sales.roleOwner')}: 100% ${t('config.sales.discountItem')}, 100% ${t('config.sales.discountGlobal')}`}
          >
            <span>100% / 100%</span>
          </div>
        </div>
      </div>

      {/* Editable role rows */}
      {DISCOUNT_ROLES.map((role) => {
        const limit = limits[role];
        const itemId = `discount-${role}-item`;
        const globalId = `discount-${role}-global`;
        return (
          <div
            key={role}
            className="flex items-start gap-4 px-pos-xl py-pos-md hover:bg-surface/40 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <label
                htmlFor={itemId}
                className="text-body-sm font-medium text-ink"
              >
                {t(`config.sales.role${role.charAt(0).toUpperCase()}${role.slice(1)}`)}
              </label>
              <p className="mt-0.5 text-body-xs text-ink-muted">
                {t('config.sales.discountHint')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <PercentField
                id={itemId}
                value={limit.itemMaxPercent}
                onChange={(v) => onChange(role, 'itemMaxPercent', v)}
                label={t('config.sales.discountItem')}
              />
              <PercentField
                id={globalId}
                value={limit.globalMaxPercent}
                onChange={(v) => onChange(role, 'globalMaxPercent', v)}
                label={t('config.sales.discountGlobal')}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface PercentFieldProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  label: string;
}

const PercentField: FC<PercentFieldProps> = ({ id, value, onChange, label }) => {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-caption text-ink-muted">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          id={id}
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = raw === '' ? 0 : Number(raw);
            const clamped = Number.isFinite(parsed)
              ? Math.max(0, Math.min(100, parsed))
              : 0;
            onChange(clamped);
          }}
          className="w-20 rounded border border-border bg-surface px-2 py-1 text-body-sm text-ink font-data tabular-nums
            transition-colors hover:border-pharma/50 focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma"
        />
        <span className="text-body-xs text-ink-muted" aria-hidden="true">
          %
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section 2 — Price overrides
// ---------------------------------------------------------------------------

interface OverridesBodyProps {
  permissions: SalesConfig['priceOverridePermissions'];
  onChange: (
    role: keyof SalesConfig['priceOverridePermissions'],
    key: 'allowed' | 'requireReason',
    value: boolean,
  ) => void;
}

const OverridesBody: FC<OverridesBodyProps> = ({ permissions, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border">
      {OVERRIDE_ROLES.map((role) => {
        const perm = permissions[role.key];
        const allowId = `override-${role.key}-allowed`;
        const reasonId = `override-${role.key}-reason`;
        return (
          <div
            key={role.key}
            className="flex items-start gap-4 px-pos-xl py-pos-md hover:bg-surface/40 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <span className="text-body-sm font-medium text-ink">
                {t(role.i18nKey)}
              </span>
              <p className="mt-0.5 text-body-xs text-ink-muted">
                {t('config.sales.sectionOverridesDesc')}
              </p>
            </div>
            <div className="flex items-start gap-6">
              <div className="flex flex-col items-end gap-1">
                <label
                  htmlFor={allowId}
                  className="text-caption text-ink-muted cursor-pointer"
                >
                  {t('config.sales.allowOverride')}
                </label>
                <ToggleSwitch
                  id={allowId}
                  checked={perm.allowed}
                  onChange={(checked) =>
                    onChange(role.key, 'allowed', checked)
                  }
                />
              </div>
              <div className="flex flex-col items-end gap-1">
                <label
                  htmlFor={reasonId}
                  className="text-caption text-ink-muted cursor-pointer"
                >
                  {t('config.sales.requireReason')}
                </label>
                <ToggleSwitch
                  id={reasonId}
                  checked={perm.requireReason}
                  onChange={(checked) =>
                    onChange(role.key, 'requireReason', checked)
                  }
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section 3 — Cost floor
// ---------------------------------------------------------------------------

interface FloorBodyProps {
  floor: SalesConfig['priceFloor'];
  onChange: (partial: Partial<SalesConfig['priceFloor']>) => void;
}

const FloorBody: FC<FloorBodyProps> = ({ floor, onChange }) => {
  const { t } = useTranslation();
  const enabledId = 'floor-enabled';
  const marginId = 'floor-margin';

  return (
    <div className="divide-y divide-border">
      {/* Enabled toggle */}
      <div className="flex items-start gap-4 px-pos-xl py-pos-md hover:bg-surface/40 transition-colors">
        <div className="flex-1 min-w-0">
          <label
            htmlFor={enabledId}
            className="text-body-sm font-medium text-ink cursor-pointer"
          >
            {t('config.sales.floorEnabled')}
          </label>
          <p className="mt-0.5 text-body-xs text-ink-muted">
            {t('config.sales.floorEnabledHint')}
          </p>
        </div>
        <ToggleSwitch
          id={enabledId}
          checked={floor.enabled}
          onChange={(checked) => onChange({ enabled: checked })}
        />
      </div>

      {/* Floor type radios + margin — only when enabled */}
      {floor.enabled && (
        <div className="px-pos-xl py-pos-md space-y-4">
          <fieldset>
            <legend className="text-body-sm font-medium text-ink">
              {t('config.sales.floorType')}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <FloorTypeOption
                value="COST"
                label={t('config.sales.floorTypeCost')}
                checked={floor.type === 'COST'}
                onChange={(v) => onChange({ type: v })}
              />
              <FloorTypeOption
                value="COST_PLUS_MARGIN"
                label={t('config.sales.floorTypeCostPlusMargin')}
                checked={floor.type === 'COST_PLUS_MARGIN'}
                onChange={(v) => onChange({ type: v })}
              />
            </div>
          </fieldset>

          {floor.type === 'COST_PLUS_MARGIN' && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor={marginId}
                className="text-body-sm font-medium text-ink"
              >
                {t('config.sales.minMargin')}
              </label>
              <p id={`${marginId}-hint`} className="text-caption text-ink-muted">
                {t('config.sales.minMarginHint')}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  id={marginId}
                  aria-describedby={`${marginId}-hint`}
                  min={0}
                  max={100}
                  step={1}
                  value={floor.minMarginPercent}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed = raw === '' ? 0 : Number(raw);
                    const clamped = Number.isFinite(parsed)
                      ? Math.max(0, Math.min(100, parsed))
                      : 0;
                    onChange({ minMarginPercent: clamped });
                  }}
                  className="w-24 rounded border border-border bg-surface px-3 py-1.5 text-body-sm text-ink font-data tabular-nums
                    transition-colors hover:border-pharma/50 focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma"
                />
                <span className="text-body-xs text-ink-muted" aria-hidden="true">
                  %
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section 4 — Customer credit
// ---------------------------------------------------------------------------

interface CreditBodyProps {
  /** Master switch for store credit. */
  creditEnabled: boolean;
  /**
   * Default credit limit in COP cents. Applied to new clients and
   * backfilled onto existing clients without a limit while credit is
   * enabled.
   */
  defaultCreditLimitCents: number;
  onEnabledChange: (enabled: boolean) => void;
  onDefaultLimitChange: (defaultCreditLimitCents: number) => void;
}

const CreditBody: FC<CreditBodyProps> = ({
  creditEnabled,
  defaultCreditLimitCents,
  onEnabledChange,
  onDefaultLimitChange,
}) => {
  const { t } = useTranslation();
  const enabledId = 'credit-enabled';
  const limitId = 'credit-default-limit';
  const [pesos, setPesos] = useState(() =>
    String(Math.round(defaultCreditLimitCents / 100)),
  );

  // Sync the local draft whenever the store value changes externally
  // (e.g. a server config pull while the tab is open), but never clobber
  // what the user is currently typing.
  useEffect(() => {
    setPesos((prev) => {
      const committed = Math.round(defaultCreditLimitCents / 100);
      const prevNumber = prev === '' ? 0 : Number(prev);
      return prevNumber === committed ? prev : String(committed);
    });
  }, [defaultCreditLimitCents]);

  return (
    <div className="divide-y divide-border">
      {/* Enabled toggle */}
      <div className="flex items-start gap-4 px-pos-xl py-pos-md hover:bg-surface/40 transition-colors">
        <div className="flex-1 min-w-0">
          <label
            htmlFor={enabledId}
            className="text-body-sm font-medium text-ink cursor-pointer"
          >
            {t('config.sales.creditEnabled')}
          </label>
          <p className="mt-0.5 text-body-xs text-ink-muted">
            {t('config.sales.creditEnabledHint')}
          </p>
        </div>
        <ToggleSwitch
          id={enabledId}
          checked={creditEnabled}
          onChange={onEnabledChange}
        />
      </div>

      {/* Default limit — only meaningful while credit is enabled */}
      <div
        className={`flex flex-col gap-1 px-pos-xl py-pos-md transition-opacity duration-200 ${
          creditEnabled ? '' : 'opacity-50'
        }`}
      >
        <label
          htmlFor={limitId}
          className={`text-body-sm font-medium ${
            creditEnabled ? 'text-ink' : 'text-ink-muted'
          }`}
        >
          {t('config.sales.defaultCreditLimit')}
        </label>
        <p id={`${limitId}-hint`} className="text-caption text-ink-muted">
          {t('config.sales.defaultCreditLimitHint')}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="text-body-sm font-medium text-ink-muted"
            aria-hidden="true"
          >
            $
          </span>
          <input
            type="number"
            id={limitId}
            aria-describedby={`${limitId}-hint`}
            min={0}
            step={1000}
            value={pesos}
            disabled={!creditEnabled}
            onChange={(e) => {
              const raw = e.target.value;
              setPesos(raw);
              const parsed = raw === '' ? 0 : Number(raw);
              const clamped = Number.isFinite(parsed)
                ? Math.max(0, Math.round(parsed))
                : 0;
              onDefaultLimitChange(clamped * 100);
            }}
            className="w-40 rounded border border-border bg-surface px-3 py-1.5 text-body-sm text-ink font-data tabular-nums
              transition-colors hover:border-pharma/50 focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma
              disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </div>
      <p className="px-pos-xl py-pos-sm text-body-xs text-ink-muted">
        {t('config.sales.creditDisabledNote')}
      </p>
    </div>
  );
};

interface FloorTypeOptionProps {
  value: PriceFloorType;
  label: string;
  checked: boolean;
  onChange: (value: PriceFloorType) => void;
}

const FloorTypeOption: FC<FloorTypeOptionProps> = ({
  value,
  label,
  checked,
  onChange,
}) => {
  return (
    <label
      className={`
        flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-body-sm
        transition-colors duration-150
        focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-pharma
        ${
          checked
            ? 'border-pharma bg-pharma/5 text-ink'
            : 'border-border bg-surface text-ink-muted hover:border-pharma/50 hover:text-ink'
        }
      `}
    >
      <input
        type="radio"
        name="floor-type"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
};
