/**
 * Cash-shift management page.
 *
 * Thin wiring container that:
 * 1. Reads the current open shift from the cash-shift store
 * 2. Shows an open-shift form (opening balance) when no shift is open
 * 3. Shows shift status + close action when a shift is open
 *
 * Presentational components (ReconciliationView, OperationalDriftBanner)
 * live in the same directory and are composed here.
 *
 * @category Page
 */
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Prisma } from '@pharmacy/database/local';
import { useCashShiftService } from '../common/service-context';
import { useCashShiftStore } from '../../../domain/cash-shift/cash-shift.store';
import { ReconciliationView } from './reconciliation-view';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import {
  ShiftAlreadyOpenException,
  MissingClosingCashCountsException,
} from '../../../domain/cash-shift/exceptions';
import { formatCurrency } from '../../utils/format-currency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageState =
  | { status: 'loading' }
  | { status: 'no-shift' }
  | { status: 'open' }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CashShiftPage: FC = () => {
  const { t } = useTranslation();
  const cashShiftService = useCashShiftService();

  // Reactive store subscription via useSyncExternalStore (vanilla zustand)
  const cashShiftState = useSyncExternalStore(
    useCashShiftStore.subscribe,
    () => useCashShiftStore.getState(),
  );
  const currentShift = cashShiftState.currentShift;
  const isLoading = cashShiftState.isLoading;

  // ---- Local UI state ----
  const [openingBalance, setOpeningBalance] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Derived page state ----
  const pageState: PageState = useMemo(() => {
    if (isLoading) return { status: 'loading' };
    if (currentShift) return { status: 'open' };
    return { status: 'no-shift' };
  }, [isLoading, currentShift]);

  // Clear transient errors when shift state changes
  useEffect(() => {
    setActionError(null);
  }, [currentShift?.id]);

  // ---- Handlers ----

  const handleOpenShift = useCallback(async () => {
    const balanceNum = Number(openingBalance);
    if (Number.isNaN(balanceNum) || balanceNum < 0) {
      setActionError(t('cash_shift.errors.invalid_balance'));
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      const shift = await cashShiftService.openShift({
        openingBalance: new Prisma.Decimal(balanceNum),
      });
      useCashShiftStore.getState().setCurrentShift(shift);
      setOpeningBalance('');
    } catch (err) {
      if (err instanceof ShiftAlreadyOpenException) {
        // Store might be stale — re-hydrate
        setActionError(t('cash_shift.errors.shift_already_open'));
      } else {
        setActionError(
          err instanceof Error ? err.message : t('common.unexpected_error'),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [openingBalance, cashShiftService, t]);

  const handleCloseShift = useCallback(async () => {
    if (!currentShift) return;

    setIsSubmitting(true);
    setActionError(null);

    try {
      await cashShiftService.closeShift(currentShift.id, {
        closingNotes: '',
      });
      useCashShiftStore.getState().setCurrentShift(null);
    } catch (err) {
      if (err instanceof MissingClosingCashCountsException) {
        setActionError(t('cash_shift.errors.missing_closing_counts'));
      } else {
        setActionError(
          err instanceof Error ? err.message : t('common.unexpected_error'),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [currentShift, cashShiftService, t]);

  // ---- Loading state ----
  if (pageState.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {t('common.loading')}
        </p>
      </div>
    );
  }

  // ---- No shift open — show opening form ----
  if (pageState.status === 'no-shift') {
    return (
      <div className="flex h-full items-start justify-center p-pos-xl pt-[15vh]">
        <div
          className="w-full max-w-md rounded-pos p-pos-xl"
          style={{
            backgroundColor: 'var(--color-panel)',
            border: '1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)',
          }}
        >
          <h1 className="pos-page-title mb-pos-lg">
            {t('cash_shift.open_shift')}
          </h1>

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
                $
              </span>
              <input
                id="opening-balance"
                type="number"
                min="0"
                step="100"
                inputMode="decimal"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="w-full rounded-pos border px-7 py-pos-sm text-body font-data tabular-nums outline-none transition-colors"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)',
                  backgroundColor: 'var(--color-surface)',
                }}
                placeholder="0"
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
            onClick={handleOpenShift}
            disabled={isSubmitting || openingBalance === ''}
            className="pos-button pos-button-primary w-full justify-center"
          >
            {isSubmitting ? t('common.loading') : t('cash_shift.open_shift_action')}
          </button>
        </div>
      </div>
    );
  }

  // ---- Shift open — show status + close action ----
  const session = useLocalSessionStore.getState().session;
  const cashierName = session?.fullName ?? '—';

  return (
    <div className="flex h-full flex-col gap-pos-lg overflow-y-auto p-pos-xl">
      <ReconciliationView
        drift={null}
        viewMode="operational"
        onToggleView={() => {}}
        shiftLabel={t('cash_shift.shift_label', {
          id: currentShift!.id.slice(0, 8).toUpperCase(),
        })}
      >
        <div className="flex flex-col gap-pos-lg">
          {/* Shift summary */}
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
                {new Date(currentShift!.openedAt).toLocaleString('es-CO')}
              </span>
            </div>
            <div>
              <span className="block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
                {t('cash_shift.opening_balance')}
              </span>
              <span className="font-data tabular-nums text-body">
                {formatCurrency(Number(currentShift!.openingBalance) * 100)}
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
              onClick={handleCloseShift}
              disabled={isSubmitting}
              className="pos-button pos-button-danger"
            >
              {isSubmitting ? t('common.loading') : t('cash_shift.close_shift_action')}
            </button>
          </div>
        </div>
      </ReconciliationView>
    </div>
  );
};
