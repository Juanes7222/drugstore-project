/**
 * ServiceLoading — full-screen spinner displayed while domain services are
 * initialising.  Used exclusively by ServiceProvider.
 */

import { useTranslation } from 'react-i18next';

export const ServiceLoading: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      className="flex h-screen flex-col items-center justify-center"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="text-center">
        <div
          className="mx-auto mb-pos-md h-8 w-8 animate-spin rounded-full border-2 border-transparent"
          style={{
            borderTopColor: 'var(--color-pharma)',
            borderRightColor: 'var(--color-pharma)',
          }}
          aria-hidden="true"
        />
        <p
          className="text-body font-medium"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('common.loading')}
        </p>
      </div>
    </div>
  );
};
