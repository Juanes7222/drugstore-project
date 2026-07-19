/**
 * Opening balance form — shown when no shift is currently open.
 *
 * Cashier enters the starting cash amount and submits to open a new shift.
 *
 * @category Component
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface OpenShiftFormProps {
  openingBalance: string;
  onOpeningBalanceChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  actionError: string | null;
}

export const OpenShiftForm: FC<OpenShiftFormProps> = ({
  openingBalance,
  onOpeningBalanceChange,
  onSubmit,
  isSubmitting,
  actionError,
}) => {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-pos-md">
        <label
          htmlFor="opening-balance"
          className="mb-pos-xs block text-body-sm font-medium"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('cash_shift.opening_balance_label')}
        </label>
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-body-sm"
            style={{ color: 'var(--color-ink-muted)' }}
          >
            {t('cash_shift.currency_symbol')}
          </span>
          <input
            id="opening-balance"
            type="number"
            min="0"
            step="100"
            inputMode="decimal"
            value={openingBalance}
            onChange={(e) => onOpeningBalanceChange(e.target.value)}
            className="w-full rounded-pos border px-7 py-pos-sm text-body font-data tabular-nums outline-none transition-colors"
            style={{
              borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)',
              backgroundColor: 'var(--color-surface)',
            }}
            placeholder={t('cash_shift.amount_placeholder')}
            disabled={isSubmitting}
            autoFocus
          />
        </div>
      </div>

      {actionError && (
        <p
          className="mb-pos-md text-body-sm"
          style={{ color: 'var(--color-urgency)' }}
          role="alert"
        >
          {actionError}
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting || openingBalance === ''}
        className="pos-button pos-button-primary w-full justify-center"
      >
        {isSubmitting ? t('common.loading') : t('cash_shift.open_shift_action')}
      </button>
    </div>
  );
};
