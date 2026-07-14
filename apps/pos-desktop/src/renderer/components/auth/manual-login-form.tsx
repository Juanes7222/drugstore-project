/**
 * Manual login form — email/username + password entry.
 *
 * Shown when the user clicks "Other account" on the avatar grid.
 * Provides text inputs for identifier and password, with a submit
 * button and a back link to return to the avatar grid.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface ManualLoginFormProps {
  identifier: string;
  password: string;
  isLoading: boolean;
  onIdentifierChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export const ManualLoginForm: FC<ManualLoginFormProps> = ({
  identifier,
  password,
  isLoading,
  onIdentifierChange,
  onPasswordChange,
  onSubmit,
  onBack,
}) => {
  const { t } = useTranslation();

  return (
    <div className="w-full flex flex-col gap-4">
      <div>
        <label
          className="block text-sm font-medium mb-1"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('auth.email_or_username')}
        </label>
        <input
          type="text"
          value={identifier}
          onChange={(e) => onIdentifierChange(e.target.value)}
          className="pos-input w-full"
          placeholder="usuario@ejemplo.com"
          autoFocus
        />
      </div>
      <div>
        <label
          className="block text-sm font-medium mb-1"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('auth.password')}
        </label>
        <div className="relative">
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className="pos-input w-full"
            placeholder="••••••••"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSubmit();
              }
            }}
          />
        </div>
      </div>
      <button
        type="button"
        disabled={!identifier || !password || isLoading}
        onClick={onSubmit}
        className="pos-button pos-button--primary w-full"
      >
        {isLoading ? t('auth.signing_in') : t('auth.sign_in')}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="text-sm"
        style={{
          color: 'var(--color-primary)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {t('auth.select_user')}
      </button>
    </div>
  );
};
