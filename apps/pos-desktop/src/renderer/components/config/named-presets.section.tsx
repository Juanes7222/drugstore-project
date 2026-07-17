/**
 * NamedPresetsSection — saved presets list with apply/delete actions.
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import type { NamedPreset } from '../../../domain/config';

export interface NamedPresetsSectionProps {
  /** List of saved presets. */
  presets: NamedPreset[];
  /** Apply a named preset. */
  onApply: (presetId: string) => void;
  /** Delete a named preset. */
  onDelete: (presetId: string) => void;
  /** Save current config as a named preset. */
  onSave: (name: string, description?: string) => void;
  /** If true, disallows editing. */
  readOnly?: boolean;
  /** Loading state. */
  loading?: boolean;
}

export const NamedPresetsSection: FC<NamedPresetsSectionProps> = ({
  presets,
  onApply,
  onDelete,
  onSave,
  readOnly = false,
  loading = false,
}) => {
  const { t } = useTranslation();
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);

  // Reset save form when toggling
  useEffect(() => {
    if (!showSaveForm) {
      setSaveName('');
      setSaveDescription('');
    }
  }, [showSaveForm]);

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    onSave(saveName.trim(), saveDescription.trim() || undefined);
    setShowSaveForm(false);
  }, [saveName, saveDescription, onSave]);

  const formatDate = useCallback((dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-ink dark:text-gray-100">
          {t('config.named_presets.title')}
        </h3>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setShowSaveForm((v) => !v)}
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
            {t('config.named_presets.save')}
          </button>
        )}
      </div>

      {/* Save form inline */}
      {showSaveForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden rounded-lg border border-pharma/30 bg-pharma/10 p-4 dark:border-blue-800 dark:bg-blue-950"
        >
          <label className="block">
            <span className="text-sm font-medium text-ink-muted dark:text-gray-300">
              {t('config.named_presets.name')}
            </span>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t('config.named_presets.name')}
              className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-sm font-medium text-ink-muted dark:text-gray-300">
              {t('config.named_presets.description')}
            </span>
            <input
              type="text"
              value={saveDescription}
              onChange={(e) => setSaveDescription(e.target.value)}
              placeholder={t('config.named_presets.description')}
              className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSaveForm(false)}
              className="rounded-lg bg-surface-variant px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="rounded-lg bg-pharma px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pharma/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
            >
              {t('common.save')}
            </button>
          </div>
        </motion.div>
      )}

      {/* Presets list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <svg
            className="h-6 w-6 animate-spin text-ink-muted"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      ) : presets.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted dark:text-gray-400">
          {t('config.history.no_history')}
        </p>
      ) : (
        <div className="space-y-2">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex-1">
                <span className="text-sm font-medium text-ink dark:text-gray-100">
                  {preset.name}
                </span>
                {preset.description && (
                  <p className="mt-0.5 text-xs text-ink-muted dark:text-gray-400">
                    {preset.description}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-ink-muted">
                  {formatDate(preset.createdAt)}
                  {preset.isShared && ` — ${t('config.named_presets.share')}`}
                </p>
              </div>
              <div className="ml-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onApply(preset.id)}
                  className="rounded-lg bg-pharma px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-pharma/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                >
                  {t('config.named_presets.apply')}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onDelete(preset.id)}
                    className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:hover:bg-red-900/20"
                    aria-label={`${t('config.named_presets.delete')} ${preset.name}`}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
