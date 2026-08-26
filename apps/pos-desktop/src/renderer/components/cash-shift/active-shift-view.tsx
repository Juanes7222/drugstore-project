/**
 * Active shift view — shows the store-wide shift metadata (opened by,
 * opened-at, opening balance, state) and, for admin-level sessions, a
 * "Cerrar turno" button that triggers the close wizard. Non-admin sessions
 * get the same information read-only with a note that an admin manages
 * open/close.
 *
 * @category Component
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ReconciliationView } from './reconciliation-view';
import { formatCurrency } from '../../utils/format-currency';
import type {
  CashShiftRecord,
  ShiftFiscalComparison,
} from '../../../domain/cash-shift/cash-shift.service';

interface ActiveShiftViewProps {
  currentShift: CashShiftRecord;
  /** Whether the session may close the shift (admin-level roles). */
  canClose?: boolean;
  onStartClose: () => void;
  actionError: string | null;
  isSubmitting: boolean;
  /** Fiscal vs operational drift data for the open shift (null when none). */
  drift?: ShiftFiscalComparison | null;
}

export const ActiveShiftView: FC<ActiveShiftViewProps> = ({
  currentShift,
  canClose = true,
  onStartClose,
  actionError,
  isSubmitting,
  drift = null,
}) => {
  const { t } = useTranslation();
  return (
    <ReconciliationView
      drift={drift}
      viewMode="operational"
      onToggleView={() => {}}
      shiftLabel={t('cash_shift.shift_label', {
        id: currentShift.id.slice(0, 8).toUpperCase(),
      })}
    >
      <div className="flex flex-col gap-pos-lg">
        {/* Store-wide scope hint — the shift is shared by every workstation */}
        <p className="text-caption" style={{ color: 'var(--color-ink-muted)' }}>
          {t('cash_shift.store_wide_hint')}
        </p>

        {/* Shift summary grid */}
        <div
          className="grid grid-cols-2 gap-pos-md rounded-pos p-pos-md"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--color-pharma) 6%, transparent)',
          }}
        >
          <div>
            <span
              className="block text-caption font-medium"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('cash_shift.opened_by')}
            </span>
            {/* The record carries only the opener's userId today; show a
                short mono form until a name resolver is available. */}
            <span
              className="font-data tabular-nums text-body"
              title={currentShift.userId}
            >
              {currentShift.userId.slice(0, 8).toUpperCase()}
            </span>
          </div>
          <div>
            <span
              className="block text-caption font-medium"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('cash_shift.opened_at')}
            </span>
            <span className="font-data tabular-nums text-body">
              {new Date(currentShift.openedAt).toLocaleString('es-CO')}
            </span>
          </div>
          <div>
            <span
              className="block text-caption font-medium"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('cash_shift.opening_balance')}
            </span>
            <span className="font-data tabular-nums text-body">
              {formatCurrency(Number(currentShift.openingBalance) * 100)}
            </span>
          </div>
          <div>
            <span
              className="block text-caption font-medium"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('cash_shift.state')}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data text-caption font-medium"
              style={{
                backgroundColor:
                  'color-mix(in srgb, var(--color-verified) 15%, transparent)',
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

        {canClose ? (
          /* Close shift button — admin-level only */
          <div
            className="flex justify-end border-t pt-pos-lg"
            style={{
              borderColor:
                'color-mix(in srgb, var(--color-ink) 8%, transparent)',
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
        ) : (
          /* Non-admin read-only note */
          <p
            className="border-t pt-pos-lg text-body-sm leading-relaxed"
            style={{
              borderColor:
                'color-mix(in srgb, var(--color-ink) 8%, transparent)',
              color: 'var(--color-ink-muted)',
            }}
          >
            {t('cash_shift.read_only_close_note')}
          </p>
        )}
      </div>
    </ReconciliationView>
  );
};
