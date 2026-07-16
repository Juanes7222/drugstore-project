/**
 * Two-factor authentication modal.
 *
 * Shown after a successful password login when the user has TOTP enabled.
 * The user can enter a TOTP code from their authenticator app, or use a
 * backup code.
 */
import { type FC, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { AuthService } from '../../../domain/auth/auth.service';

interface TwoFactorModalProps {
  challengeToken: string;
  authService: AuthService;
  onComplete: () => void;
  onCancel: () => void;
}

export const TwoFactorModal: FC<TwoFactorModalProps> = ({
  challengeToken,
  authService,
  onComplete,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleVerify = useCallback(async () => {
    if ((mode === 'totp' && code.length !== 6) || (mode === 'backup' && backupCode.length < 8)) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await authService.completeTwoFactor(
        challengeToken,
        mode === 'totp' ? code : undefined,
        mode === 'backup' ? backupCode : undefined,
      );
      onComplete();
    } catch (err) {
      setError(
        (err as Error).message || t('auth.totp_invalid'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [challengeToken, code, backupCode, mode, authService, onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="pos-panel max-w-sm w-full p-pos-xl"
        style={{ backgroundColor: 'var(--color-surface)' }}
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -8 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2
          className="text-heading font-bold mb-2"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('auth.two_factor_title')}
        </h2>
        <p
          className="text-body mb-4"
          style={{ color: 'var(--color-ink-muted)' }}
        >
          {mode === 'totp'
            ? t('auth.totp_instruction')
            : t('auth.backup_instruction')}
        </p>

        {/* Mode tabs */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('totp')}
            style={{
              flex: 1,
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              border: mode === 'totp' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              backgroundColor: mode === 'totp' ? 'var(--color-primary-container)' : 'transparent',
              color: 'var(--color-ink)',
              fontWeight: mode === 'totp' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {t('auth.totp')}
          </button>
          <button
            type="button"
            onClick={() => setMode('backup')}
            style={{
              flex: 1,
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              border: mode === 'backup' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              backgroundColor: mode === 'backup' ? 'var(--color-primary-container)' : 'transparent',
              color: 'var(--color-ink)',
              fontWeight: mode === 'backup' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {t('auth.backup_code')}
          </button>
        </div>

        {mode === 'totp' ? (
          <div className="flex flex-col items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              className="pos-input text-center text-2xl tracking-widest"
              style={{ fontVariantNumeric: 'tabular-nums' }}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <input
              type="text"
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              className="pos-input text-center text-lg tracking-wider"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />
          </div>
        )}

        {error && (
          <p
            className="text-sm mt-2 text-center"
            style={{ color: 'var(--color-error)' }}
          >
            {error}
          </p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="pos-button pos-button--ghost flex-1"
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={
              isLoading ||
              (mode === 'totp' && code.length !== 6) ||
              (mode === 'backup' && backupCode.length < 8)
            }
            onClick={handleVerify}
            className="pos-button pos-button--primary flex-1"
          >
            {isLoading ? t('auth.verifying') : t('auth.verify')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
