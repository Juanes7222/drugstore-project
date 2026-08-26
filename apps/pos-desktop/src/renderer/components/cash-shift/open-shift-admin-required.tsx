/**
 * Read-only notice shown on the cash-shift page when the current session
 * has no shift-opening permission (non-admin roles) and the store-wide
 * shift is closed. Replaces the opening-balance form for those users.
 *
 * @category Component
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { LockIcon } from '@/components/ui/icons';

export const OpenShiftAdminRequired: FC = () => {
  const { t } = useTranslation();

  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-pos-md rounded-pos p-pos-xl text-center"
      role="status"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-ink) 3%, transparent)',
        border:
          '1px dashed color-mix(in srgb, var(--color-ink) 20%, transparent)',
      }}
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        aria-hidden="true"
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--color-attention) 15%, transparent)',
        }}
      >
        <LockIcon
          size={24}
          strokeWidth={1.5}
          style={{ color: 'var(--color-attention)' }}
        />
      </div>

      <p
        className="text-body font-semibold"
        style={{ color: 'var(--color-ink)' }}
      >
        {t('cash_shift.admin_gate_open_title')}
      </p>
      <p
        className="text-body-sm leading-relaxed"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        {t('cash_shift.admin_gate_open_description')}
      </p>
    </div>
  );
};
