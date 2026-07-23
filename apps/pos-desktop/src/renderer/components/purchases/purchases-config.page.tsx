/**
 * Purchases Config page — manage purchase workflow settings.
 *
 * Thin wiring container: reads config from local-config store, provides
 * change/save handlers, and renders the presentational PurchasesConfigForm.
 *
 * @category Page
 */

import { type FC, useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { navigateToPurchasesMain } from '@/store/slices/ui-slice';
import {
  getPurchasesConfig,
  useLocalConfigStore,
} from '../../../domain/configuration';
import type { PurchasesConfig } from '../../../domain/configuration';
import { PurchasesConfigForm } from './purchases-config-form';

// ── Page component ──────────────────────────────────────────────────────

export const PurchasesConfigPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  // Copy current config into local edit state on mount.
  const [editState, setEditState] = useState<PurchasesConfig>(() => ({
    ...getPurchasesConfig(),
  }));
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleChange = useCallback((partial: Partial<PurchasesConfig>) => {
    setEditState((prev) => ({ ...prev, ...partial }));
    setSaved(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(() => {
    try {
      useLocalConfigStore.getState().updatePurchasesConfig(editState);
      setSaved(true);
      setSaveError(null);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Error saving configuration',
      );
    }
  }, [editState]);

  const handleBack = useCallback(() => {
    dispatch(navigateToPurchasesMain());
  }, [dispatch]);

  return (
    <div className="flex flex-col h-full p-6 bg-surface">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleBack}
          className="pos-icon-button"
          aria-label={t('common.back')}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <div>
          <h1 className="pos-page-title">
            {t('purchases.config.title')}
          </h1>
        </div>
      </div>

      {/* Success feedback */}
      {saved && (
        <div className="mb-4 px-4 py-2 rounded bg-pharma/10 text-pharma text-sm font-medium">
          {t('purchases.config.saved')}
        </div>
      )}

      {/* Error feedback */}
      {saveError && (
        <div className="mb-4 px-4 py-2 rounded bg-restrict/10 text-restrict text-sm font-medium">
          {saveError}
        </div>
      )}

      {/* Presentational form */}
      <div className="flex-1 overflow-y-auto">
        <PurchasesConfigForm
          config={editState}
          onChange={handleChange}
          onSave={handleSave}
        />
      </div>
    </div>
  );
};
