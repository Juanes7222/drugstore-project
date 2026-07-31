/**
 * NamedPresetsSection — saved presets list with apply/delete actions.
 *
 * All elements use POS design system component classes for visual consistency.
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { CheckIcon, PlusIcon, Trash2Icon } from "@/components/ui/icons";

import type { NamedPreset } from '../../../domain/config';
import { LoaderIcon } from "@/components/ui/icons/animated";

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
    <div className="space-y-pos-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-ui font-semibold text-ink">
          {t('config.named_presets.title')}
        </h3>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setShowSaveForm((v) => !v)}
            className="pos-button pos-button-primary gap-pos-xs"
          >
            <PlusIcon size={14} strokeWidth={1.5} aria-hidden="true" />
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
          className="overflow-hidden rounded-sm border border-pharma/30 bg-pharma/[0.06] p-pos-md"
        >
          <label className="block">
            <span className="text-body-sm font-medium text-ink-muted">
              {t('config.named_presets.name')}
            </span>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t('config.named_presets.name')}
              className="pos-input mt-pos-xs"
            />
          </label>
          <label className="mt-pos-md block">
            <span className="text-body-sm font-medium text-ink-muted">
              {t('config.named_presets.description')}
            </span>
            <input
              type="text"
              value={saveDescription}
              onChange={(e) => setSaveDescription(e.target.value)}
              placeholder={t('config.named_presets.description')}
              className="pos-input mt-pos-xs"
            />
          </label>
          <div className="mt-pos-md flex justify-end gap-pos-sm">
            <button
              type="button"
              onClick={() => setShowSaveForm(false)}
              className="pos-button pos-button-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="pos-button pos-button-primary"
            >
              {t('common.save')}
            </button>
          </div>
        </motion.div>
      )}

      {/* Presets list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <LoaderIcon className="h-6 w-6 text-ink-muted" />
        </div>
      ) : presets.length === 0 ? (
        <p className="py-pos-md text-body-sm text-ink-muted">
          {t('config.history.no_history')}
        </p>
      ) : (
        <div className="space-y-pos-xs">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between rounded-sm border border-border bg-panel px-pos-md py-pos-sm"
            >
              <div className="flex-1">
                <span className="text-body-sm font-medium text-ink">
                  {preset.name}
                </span>
                {preset.description && (
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {preset.description}
                  </p>
                )}
                <p className="mt-0.5 text-caption text-ink-muted">
                  {formatDate(preset.createdAt)}
                  {preset.isShared && ` — ${t('config.named_presets.share')}`}
                </p>
              </div>
              <div className="ml-pos-md flex items-center gap-pos-sm">
                <button
                  type="button"
                  onClick={() => onApply(preset.id)}
                  className="pos-button pos-button-primary gap-pos-xs text-caption"
                >
                  <CheckIcon size={12} strokeWidth={1.5} aria-hidden="true" />
                  {t('config.named_presets.apply')}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onDelete(preset.id)}
                    className="pos-button pos-button-secondary p-1.5 hover:bg-error-container hover:text-error focus-visible:outline-error"
                    aria-label={`${t('config.named_presets.delete')} ${preset.name}`}
                  >
                    <Trash2Icon size={14} strokeWidth={1.5} aria-hidden="true" />
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
