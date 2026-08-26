/**
 * Persistent cash-shift header displayed on every POS screen.
 *
 * Shows the store-wide shift STATE first (open / none), the opening balance
 * and elapsed active time while a shift is open, plus the logged-in operator
 * name. The shift belongs to the store, not to this workstation or user, so
 * the operator is labeled separately from the shift itself.
 *
 * When the props are omitted (undefined) the component falls back to the
 * current open shift from the cash-shift Zustand store — meaning most
 * callers in App.tsx can simply omit openingBalanceCents / openedAt and
 * get real data automatically.
 */
import { type FC, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useElapsedTime } from '@/hooks/use-elapsed-time';
import { formatCurrency } from '@/utils/format-currency';
import { SyncState } from './sync-pulse';
import { useCashShiftStore } from '../../../domain/cash-shift/cash-shift.store';

interface CashShiftHeaderProps {
  /** Logged-in operator (session identity, not the shift owner). */
  cashierName: string;
  /** Optional: fallback to current open shift from the store. */
  openingBalanceCents?: number;
  /** Optional: fallback to current open shift from the store. */
  openedAt?: string;
  syncState: SyncState;
  onSyncStateChange?: (state: SyncState) => void;
}

const SYNC_STATES: SyncState[] = ['online', 'offline', 'draining'];

export const CashShiftHeader: FC<CashShiftHeaderProps> = ({
  cashierName,
  openingBalanceCents: openingBalanceCentsProp,
  openedAt: openedAtProp,
  syncState,
  onSyncStateChange,
}) => {
  const { t } = useTranslation();

  // Read current open shift from store as fallback (vanilla zustand)
  const cashShiftState = useSyncExternalStore(useCashShiftStore.subscribe, () =>
    useCashShiftStore.getState(),
  );
  const currentShift = cashShiftState.currentShift;

  const openingBalanceCents =
    openingBalanceCentsProp ??
    (currentShift ? Number(currentShift.openingBalance) * 100 : 0);

  const openedAt =
    openedAtProp ??
    currentShift?.openedAt?.toISOString() ??
    new Date().toISOString();

  // Only tick the elapsed timer while a store-wide shift is actually open.
  // A caller-supplied balance/time counts as an open shift too (callers that
  // pass explicit props own their shift source).
  const hasOpenShift =
    Boolean(currentShift) || openingBalanceCentsProp !== undefined;
  const elapsed = useElapsedTime(openedAt, hasOpenShift);

  return (
    <header
      className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-pos-md gap-y-pos-xs px-pos-md py-pos-sm bg-panel"
      style={{
        borderBottom:
          '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-pos-lg gap-y-pos-xs">
        {/* Shift state — store-wide resource, never tied to this workstation */}
        <span
          className="min-w-0 truncate text-body font-semibold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('cash_shift.header_label')}:
          {currentShift ? (
            <>
              {' '}
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
            </>
          ) : (
            <span
              className="font-normal text-caption"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('cash_shift.no_open_shift_short')}
            </span>
          )}
        </span>

        {hasOpenShift && (
          <>
            <span
              className="whitespace-nowrap text-caption"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 60%, transparent)',
              }}
            >
              {t('cash_shift.opening_balance')}:{' '}
              <span className="font-data tabular-nums">
                {formatCurrency(openingBalanceCents)}
              </span>
            </span>
            <span
              className="whitespace-nowrap font-data tabular-nums text-body"
              style={{ color: 'var(--color-pharma)' }}
            >
              {elapsed} {t('cash_shift.active')}
            </span>
          </>
        )}

        {/* Session identity — separate from shift ownership */}
        <span
          className="whitespace-nowrap text-caption"
          style={{
            color: 'color-mix(in srgb, var(--color-ink) 60%, transparent)',
          }}
        >
          {t('cash_shift.operator_label')}: {cashierName}
        </span>
      </div>

      {onSyncStateChange && (
        <div
          className="flex shrink-0 items-center gap-pos-xs"
          role="group"
          aria-label={t('sync.state_online')}
        >
          {SYNC_STATES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => onSyncStateChange(state)}
              className={`pos-button text-caption px-pos-sm py-pos-xs ${
                syncState === state
                  ? 'pos-button-primary'
                  : 'pos-button-secondary'
              }`}
              aria-pressed={syncState === state}
            >
              {t(`sync.state_${state}`)}
            </button>
          ))}
        </div>
      )}
    </header>
  );
};
