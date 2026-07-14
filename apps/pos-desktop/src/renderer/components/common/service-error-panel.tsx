/**
 * ServiceErrorPanel — full-screen fatal-error panel shown when domain service
 * initialisation fails.  Used exclusively by ServiceProvider.
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface ServiceErrorPanelProps {
  error: Error;
  onRetry?: () => void;
}

export const ServiceErrorPanel: FC<ServiceErrorPanelProps> = ({
  error,
  onRetry,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex h-screen flex-col items-center justify-center p-pos-xl"
      style={{ backgroundColor: 'var(--color-surface)' }}
      role="alert"
    >
      <div className="pos-panel max-w-lg p-pos-xl text-center">
        <h1
          className="text-heading font-bold"
          style={{ color: 'var(--color-urgency)' }}
        >
          {t('common.app_name')}
        </h1>
        <p
          className="mt-pos-md text-body"
          style={{
            color: 'color-mix(in srgb, var(--color-ink) 60%, transparent)',
          }}
        >
          {t('common.loading')}
        </p>
        <p className="mt-pos-sm font-data text-caption">
          {error.message}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-pos-md rounded-md px-pos-md py-pos-sm text-body font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--color-pharma)' }}
          >
            {t('common.retry')}
          </button>
        )}
      </div>
    </div>
  );
};
