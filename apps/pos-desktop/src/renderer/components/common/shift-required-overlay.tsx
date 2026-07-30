/**
 * Shift-required overlay — blocks the sales screen when no cash shift is open.
 *
 * Shows a centered warning with a direct "Go to Cash Shift" button so the
 * cashier can open a shift without manually navigating. The button is gated
 * to roles that can open a shift (CASHIER+). Users without permission (e.g.
 * a role error scenario) see the message without the button, though in
 * practice the navigation sidebar already limits sales access to CASHIER+.
 *
 * @category Component
 */
import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { navigateToCashShift } from '@/store/slices/ui-slice';
import { useLocalSessionStore, hasMinRole } from '../../../domain/auth/local-session.store';
import { RoleType } from '@pharmacy/shared-types';
import { DollarSignIcon } from "@/components/ui/icons";

export const ShiftRequiredOverlay: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const session = useLocalSessionStore((s) => s.session);
  const canOpenShift = hasMinRole(session, RoleType.CASHIER);

  const handleGoToCashShift = useCallback(() => {
    dispatch(navigateToCashShift());
  }, [dispatch]);

  return (
    <div className="flex h-full items-center justify-center p-pos-xl">
      <div
        className="mx-auto max-w-md rounded-pos p-pos-xl text-center"
        style={{
          backgroundColor: 'var(--color-panel)',
          border: '1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)',
        }}
      >
        {/* Cash icon */}
        <div
          className="mx-auto mb-pos-lg flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-attention) 15%, transparent)',
          }}
          aria-hidden="true"
        >
          <DollarSignIcon size={32} strokeWidth={1.5} style={{ color: 'var(--color-attention)' }} />
        </div>

        <h2
          className="mb-pos-md text-body-lg font-semibold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('shift_guard.no_active_shift_title')}
        </h2>

        <p
          className="mb-pos-xl text-body-sm leading-relaxed"
          style={{ color: 'var(--color-ink-muted)' }}
        >
          {t('shift_guard.no_active_shift_description')}
        </p>

        {canOpenShift && (
          <button
            type="button"
            onClick={handleGoToCashShift}
            className="pos-button pos-button-primary inline-flex items-center gap-2"
          >
            <DollarSignIcon size={16} />
            {t('shift_guard.open_shift_button')}
          </button>
        )}
      </div>
    </div>
  );
};
