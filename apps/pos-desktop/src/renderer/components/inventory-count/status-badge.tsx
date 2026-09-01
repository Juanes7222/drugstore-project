import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

const MAP: Record<string, { bg: string; fg: string; dot: string }> = {
  DRAFT: { bg: 'color-mix(in srgb, var(--color-ink) 8%, transparent)', fg: 'var(--color-ink-muted)', dot: 'var(--color-ink-muted)' },
  IN_PROGRESS: { bg: 'color-mix(in srgb, var(--color-pharma) 10%, transparent)', fg: 'var(--color-pharma)', dot: 'var(--color-pharma)' },
  IN_REVIEW: { bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', fg: '#92400E', dot: 'var(--color-warning)' },
  CLOSED: { bg: 'var(--color-success-container)', fg: 'var(--color-success)', dot: 'var(--color-success)' },
  CANCELLED: { bg: 'var(--color-error-container)', fg: 'var(--color-error)', dot: 'var(--color-error)' },
};

export const StatusBadge: FC<{ state: string }> = ({ state }) => {
  const { t } = useTranslation();
  const cfg = MAP[state] ?? MAP.DRAFT;
  const label = t(`inventory_count.status.${state}`, { defaultValue: state });
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
      aria-label={`${t('common.status', { defaultValue: 'Estado' })}: ${label}`}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.dot }} aria-hidden />
      {label}
    </span>
  );
};
