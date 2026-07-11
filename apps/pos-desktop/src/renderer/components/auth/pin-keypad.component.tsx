/**
 * Touch-friendly numeric keypad for PIN entry.
 *
 * Features:
 * - Large touch targets for dirty screens
 * - Optional shuffle mode for high-security environments
 * - Auto-submit on 4-6 digits entered
 * - Show/hide toggle
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface PinKeypadProps {
  length?: number;
  onComplete: (pin: string) => void;
  onCancel?: () => void;
  error?: string | null;
  isLoading?: boolean;
  shuffle?: boolean;
  label?: string;
}

export const PinKeypad: FC<PinKeypadProps> = ({
  length = 6,
  onComplete,
  onCancel,
  error = null,
  isLoading = false,
  shuffle = false,
  label,
}) => {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [visible, setVisible] = useState(false);
  const [keys, setKeys] = useState<string[]>(['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']);

  useEffect(() => {
    if (shuffle) {
      const numbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
      }
      setKeys([...numbers, '', '0', '⌫']);
    }
  }, [shuffle]);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (isLoading) return;

      if (key === '⌫') {
        setPin((prev) => prev.slice(0, -1));
      } else if (key === '' || key === ' ') {
        return; // empty space
      } else if (pin.length < length) {
        const newPin = pin + key;
        setPin(newPin);

        // Auto-submit when PIN reaches the required length
        if (newPin.length === length) {
          setTimeout(() => onComplete(newPin), 150);
        }
      }
    },
    [pin, length, onComplete, isLoading],
  );

  const handleSubmit = useCallback(() => {
    if (pin.length >= 4 && !isLoading) {
      onComplete(pin);
    }
  }, [pin, onComplete, isLoading]);

  return (
    <div className="flex flex-col items-center gap-pos-md">
      {/* Label */}
      <label className="text-body font-medium" style={{ color: 'var(--color-ink)' }}>
        {label ?? t('auth.pin_label')}
      </label>

      {/* PIN display */}
      <div
        className="flex items-center gap-2 p-pos-sm"
        style={{
          backgroundColor: 'var(--color-surface-variant)',
          borderRadius: 'var(--radius-md)',
          minHeight: 48,
          cursor: 'pointer',
        }}
        onClick={() => setVisible(!visible)}
        role="button"
        tabIndex={0}
        aria-label={visible ? t('auth.hide_pin_aria') : t('auth.show_pin_aria')}
      >
        <div className="flex gap-2" style={{ minWidth: length * 24 }}>
          {Array.from({ length }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                backgroundColor:
                  i < pin.length
                    ? 'var(--color-primary)'
                    : 'var(--color-border)',
                transition: 'background-color 0.15s',
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-ink-muted)' }}>
          {visible ? t('auth.hide_pin') : t('auth.show_pin')}
        </span>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm" style={{ color: 'var(--color-error)' }}>
          {error}
        </p>
      )}

      {/* Numeric keypad */}
      <div
        className="grid grid-cols-3 gap-3"
        style={{ maxWidth: 280 }}
        role="group"
        aria-label={t('auth.numeric_keypad_aria')}
      >
        {keys.map((key, i) => {
          if (key === '') {
            return <div key={i} style={{ width: 80, height: 64 }} />;
          }

          const isDelete = key === '⌫';
          return (
            <button
              key={`${key}-${i}`}
              type="button"
              disabled={isLoading}
              onClick={() => handleKeyPress(key)}
              style={{
                width: 80,
                height: 64,
                fontSize: isDelete ? 18 : 24,
                fontWeight: 600,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-ink)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isLoading ? 0.5 : 1,
              }}
              aria-label={isDelete ? t('auth.delete_key_aria') : key}
            >
              {isDelete ? '⌫' : key}
            </button>
          );
        })}
      </div>

      {/* Submit button (for non-auto-submit) */}
      <button
        type="button"
        disabled={pin.length < 4 || isLoading}
        onClick={handleSubmit}
        className="pos-button pos-button--primary"
        style={{
          width: '100%',
          maxWidth: 280,
          opacity: pin.length < 4 || isLoading ? 0.5 : 1,
        }}
      >
        {isLoading ? t('auth.verifying_pin') : t('auth.submit_pin')}
      </button>

      {/* Cancel */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="pos-button pos-button--ghost"
          disabled={isLoading}
        >
          {t('auth.cancel_pin')}
        </button>
      )}
    </div>
  );
};
