/**
 * Active shift view — shows shift metadata (cashier, opened-at, opening
 * balance, state) and a "Cerrar turno" button that triggers the close wizard.
 *
 * @category Component
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ReconciliationView } from './reconciliation-view';
import { formatCurrency } from '../../utils/format-currency';
import type { CashShiftRecord } from '../../../domain/cash-shift/cash-shift.service';

interface ActiveShiftViewProps {
  currentShift: CashShiftRecord;
  cashierName: string;
  onStartClose: () => void;
  actionError: string | null;
  isSubmitting: boolean;
}

export const ActiveShiftView: FC<ActiveShiftViewProps> = ({
  currentShift,
  cashierName,
  onStartClose,
  actionError,
  isSubmitting,
}) => {
  const { t } = useTranslation();
  return (
    <ReconciliationView
      drift={null}
      viewMode="operational"
      onToggleView={() => {}}
      shiftLabel={t('cash_shift.shift_label', {
        id: currentShift.id.slice(0, 8).toUpperCase(),
      })}
    >
      <div className="flex flex-col gap-pos-lg">
        {/* Shift summary grid */}
        <div
          className="grid grid-cols-2 gap-pos-md rounded-pos p-pos-md"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-pharma) 6%, transparent)',
          }}
        >
          <div>
            <span className="block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.cashier')}
            </span>
            <span className="font-data tabular-nums text-body">
              {cashierName}
            </span>
          </div>
          <div>
            <span className="block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.opened_at')}
            </span>
            <span className="font-data tabular-nums text-body">
              {new Date(currentShift.openedAt).toLocaleString('es-CO')}
            </span>
          </div>
          <div>
            <span className="block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.opening_balance')}
            </span>
            <span className="font-data tabular-nums text-body">
              {formatCurrency(Number(currentShift.openingBalance) * 100)}
            </span>
          </div>
          <div>
            <span className="block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.state')}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data text-caption font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-verified) 15%, transparent)',
                color: 'var(--color-verified)',
              }}
            >
              {t('cash_shift.state_open')}
            </span>
          </div>
        </div>

        {/* Action error */}
        {actionError && (
          <p
            className="text-body-sm"
            style={{ color: 'var(--color-urgency)' }}
            role="alert"
          >
            {actionError}
          </p>
        )}

        {/* Close shift button */}
        <div className="flex justify-end border-t pt-pos-lg"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
          }}
        >
          <button
            type="button"
            onClick={onStartClose}
            disabled={isSubmitting}
            className="pos-button pos-button-danger"
          >
            {t('cash_shift.close_shift_action')}
          </button>
        </div>
      </div>
    </ReconciliationView>
  );
};
