/**
 * Forgot password page.
 *
 * Allows users to request a password reset link sent to their email.
 * For cashiers: informs them to ask their manager to reset the PIN.
 */
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { createAuthService } from '../../../domain/auth/auth.service';
import { API_BASE_URL } from '@infra/config';

export const ForgotPasswordPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authService] = useState(() =>
    createAuthService({
      baseUrl: API_BASE_URL,
    }),
  );

  const handleSubmit = async () => {
    if (!email) return;
    setIsLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await authService.forgotPassword(email);
      setMessage(
        result.message || t('auth.forgot_password_message'),
      );
    } catch (err) {
      setError(t('auth.forgot_password_error'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="flex h-screen flex-col items-center justify-center p-pos-xl"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-4">
        <h1
          className="text-heading font-bold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('auth.forgot_password')}
        </h1>

        {/* Cashier info */}
        <div
          className="p-3 rounded-md text-sm"
          style={{
            backgroundColor: 'var(--color-surface-variant)',
            color: 'var(--color-ink-muted)',
          }}
        >
          {t('auth.cashier_reset_info')}
        </div>

        <div className="w-full">
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('auth.email')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pos-input w-full"
            placeholder="usuario@ejemplo.com"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
        )}

        {message && (
          <p
            className="text-sm p-3 rounded-md"
            style={{
              color: 'var(--color-success)',
              backgroundColor: 'var(--color-success-container)',
            }}
          >
            {message}
          </p>
        )}

        <button
          type="button"
          disabled={!email || isLoading}
          onClick={handleSubmit}
          className="pos-button pos-button--primary w-full"
        >
          {isLoading ? t('auth.sending') : t('auth.send_link')}
        </button>

        <button
          type="button"
          onClick={() => dispatch(setActiveScreen('login'))}
          className="text-sm"
          style={{
            color: 'var(--color-primary)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {t('auth.back_to_login')}
        </button>
      </div>
    </div>
  );
};
