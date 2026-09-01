import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardListIcon, CalendarIcon, TagIcon } from '@/components/ui/icons';
import { StatusBadge } from './status-badge';
import { ProgressBar } from './progress-bar';
import type { CountSessionDto } from '../../../domain/inventory-count';

/** Card for a count session — two densities. Active has pharma left border + subtle lift. */
export const SessionCard: FC<{
  session: CountSessionDto;
  onOpen: () => void;
  compact?: boolean;
}> = ({ session, onOpen, compact }) => {
  const { t } = useTranslation();
  const date = new Date(session.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  const progress = session.totalLines ? Math.round((session.countedLines / session.totalLines) * 100) : 0;
  const isActive = session.state === 'IN_PROGRESS' || session.state === 'IN_REVIEW';
  const scopeLabel = session.scopeType === 'FULL' ? t('inventory_count.card.scope_full') : (session.scopeLabel ?? session.scopeValue ?? session.scopeType);
  const modeLabel = session.mode === 'BLIND' ? t('inventory_count.card.mode_blind') : t('inventory_count.card.mode_informed');
  const fallbackName = t('inventory_count.card.fallback_name');

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${t('common.open', { defaultValue: 'Abrir' })} ${session.code} — ${session.state}`}
      className="pos-panel group flex w-full flex-col gap-3 p-4 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pharma)] focus-visible:ring-offset-1"
      style={{ borderLeft: isActive ? '3px solid var(--color-pharma)' : '3px solid transparent' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--color-pharma) 10%, transparent)', color: 'var(--color-pharma)' }} aria-hidden>
            <ClipboardListIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-semibold leading-none tabular-nums" style={{ color: 'var(--color-ink)' }}>{session.code}</p>
            <p className="mt-1 truncate text-xs max-w-[18ch]" style={{ color: 'var(--color-ink-muted)' }}>{session.name ?? fallbackName}</p>
          </div>
        </div>
        <StatusBadge state={session.state} />
      </div>

      {!compact && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)', color: 'var(--color-ink-muted)' }}>
              <CalendarIcon size={12} aria-hidden /> {date}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)', color: 'var(--color-ink-muted)' }}>
              <TagIcon size={12} aria-hidden /> <span className="truncate max-w-[14ch]">{scopeLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs capitalize" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)', color: 'var(--color-ink-muted)' }}>
              {modeLabel} · {t('inventory_count.card.tolerance', { value: session.tolerancePercent })}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>
              <span>{t('inventory_count.card.counted', { counted: session.countedLines, total: session.totalLines })}</span>
              <span className="font-medium" style={{ color: session.discrepancyCount ? 'var(--color-warning)' : 'var(--color-ink-muted)' }}>{t('inventory_count.card.discrepancies', { count: session.discrepancyCount })}</span>
            </div>
            <ProgressBar percent={progress} size="sm" label={t('inventory_count.detail.progress', { percent: progress })} />
          </div>
        </>
      )}
    </button>
  );
};
