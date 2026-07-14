/**
 * Login header — app logo/title section.
 *
 * Shows the application name and a login prompt at the top of the login page.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

export const LoginHeader: FC = () => {
  const { t } = useTranslation();

  return (
    <>
      <h1
        className="text-heading font-bold"
        style={{ color: 'var(--color-ink)' }}
      >
        {t('common.app_name')}
      </h1>
      <p
        className="text-body"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        {t('auth.login_title')}
      </p>
    </>
  );
};
