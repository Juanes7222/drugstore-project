/**
 * Reset password page.
 *
 * Shown when the user clicks the reset link from their email.
 * The token is extracted from the URL (query parameter).
 */
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { createAuthService } from '../../../domain/auth/auth.service';
import { API_BASE_URL } from '@infra/config';

interface ResetPasswordPageProps {
  token?: string;
}

export const ResetPasswordPage: FC<ResetPasswordPageProps> = ({
  token: _token,
}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authService] = useState(() =>
    createAuthService({
      baseUrl: API_BASE_URL,
    }),
  );

  const handleSubmit = async () => {
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwords_mismatch'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('auth.password_min_length'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // In production, extract token from URL
      const token = _token || new URLSearchParams(window.location.search).get('token') || '';
      await authService.resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(t('auth.reset_password_error'));
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center p-pos-xl"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <div className="w-full max-w-sm text-center">
          <h1
            className="text-heading font-bold mb-2"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('auth.password_reset_success')}
          </h1>
          <p
            className="mb-4"
            style={{ color: 'var(--color-ink-muted)' }}
          >
            {t('auth.password_reset_login')}
          </p>
          <button
            type="button"
            onClick={() => dispatch(setActiveScreen('login'))}
            className="pos-button pos-button--primary"
          >
            {t('auth.back_to_login') || 'Iniciar sesión'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen flex-col items-center justify-center p-pos-xl"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="w-full max-w-sm flex flex-col gap-4">
        <h1
          className="text-heading font-bold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('auth.set_new_password')}
        </h1>

        <div>
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('auth.new_password')}
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="pos-input w-full"
            placeholder={t('auth.password_placeholder')}
            autoFocus
          />
        </div>

        <div>
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('auth.confirm_password')}
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="pos-input w-full"
            placeholder={t('auth.confirm_placeholder')}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={!newPassword || !confirmPassword || isLoading}
          onClick={handleSubmit}
          className="pos-button pos-button--primary w-full"
        >
          {isLoading ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
};
