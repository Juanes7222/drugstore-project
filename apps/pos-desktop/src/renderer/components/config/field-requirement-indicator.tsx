/**
 * FieldRequirementIndicator — small badge showing field requirement status.
 *
 * "Requerido" (red), "Opcional" (gray), "Oculto" (hidden level).
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldRequirement } from '../../../domain/config';

export interface FieldRequirementIndicatorProps {
  /** The requirement level. */
  requirement: FieldRequirement;
}

const STYLES: Record<FieldRequirement, string> = {
  REQUIRED:
    'bg-error-container text-error border-error-container dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  OPTIONAL:
    'bg-surface-variant text-ink-muted border-border dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  HIDDEN:
    'bg-transparent text-ink-muted border-transparent dark:text-gray-600',
};

const I18N_KEYS: Record<FieldRequirement, string> = {
  REQUIRED: 'preview.requirement_required',
  OPTIONAL: 'preview.requirement_never',
  HIDDEN: 'preview.action_hidden',
};

export const FieldRequirementIndicator: FC<FieldRequirementIndicatorProps> = ({
  requirement,
}) => {
  const { t } = useTranslation();

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[requirement]}`}
      aria-label={t('config.' + I18N_KEYS[requirement])}
    >
      {requirement === 'HIDDEN' ? null : (
        <span
          className={`mr-1 h-1.5 w-1.5 rounded-full ${
            requirement === 'REQUIRED'
              ? 'bg-error'
              : 'bg-ink-muted dark:bg-gray-500'
          }`}
          aria-hidden="true"
        />
      )}
      {requirement === 'REQUIRED'
        ? t('config.preview.requirement_required')
        : requirement === 'OPTIONAL'
          ? t('config.preview.requirement_never')
          : null}
    </span>
  );
};
