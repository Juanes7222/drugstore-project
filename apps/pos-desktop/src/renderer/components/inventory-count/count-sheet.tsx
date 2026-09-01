/**
 * CountSheet — tabla + cards responsive para conteo ciego/informado.
 * Desktop: tabla densa. Mobile: cards apiladas. Enter guarda, foco avanza, feedback visual con ring.
 */
import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { SearchIcon, BarcodeIcon, AlertTriangleIcon, CheckCircleIcon, EyeIcon } from '@/components/ui/icons';
import type { CountLineDto } from '../../../domain/inventory-count';

export const CountSheet: FC<{
  lines: CountLineDto[];
  total: number;
  mode: 'BLIND' | 'INFORMED';
  scopeLabel?: string | null;
  onRecord: (lineId: string, qty: number) => Promise<void>;
  onSetFinal: (lineId: string, qty: number) => Promise<void>;
  onSearch: (q: string) => void;
  search: string;
  filter: 'ALL' | 'PENDING' | 'RECOUNT' | 'REVIEW';
  onFilter: (f: 'ALL' | 'PENDING' | 'RECOUNT' | 'REVIEW') => void;
  barcodeToFocus?: string | null;
}> = ({ lines, total, mode, onRecord, onSetFinal, onSearch, search, filter, onFilter }) => {
  const { t } = useTranslation();
  const [localQty, setLocalQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const reduce = useReducedMotion();

  const filtered = useMemo(() => lines, [lines]);

  const handleSave = async (line: CountLineDto) => {
    const raw = localQty[line.id];
    if (raw == null || raw === '') return;
    const qty = Number(raw);
    if (!Number.isInteger(qty) || qty < 0) return;
    setSaving(line.id);
    try {
      if (line.status === 'REQUIRES_REVIEW') {
        await onSetFinal(line.id, qty);
      } else {
        await onRecord(line.id, qty);
      }
      setLocalQty((m) => ({ ...m, [line.id]: '' }));
      setSavedFlash(line.id);
      setTimeout(() => setSavedFlash((curr) => (curr === line.id ? null : curr)), 900);
      // Focus next pending for scan flow
      const idx = filtered.findIndex((l) => l.id === line.id);
      const next = filtered.slice(idx + 1).find((l) => l.status === 'PENDING' || l.status === 'RECOUNT_NEEDED' || l.status === 'REQUIRES_REVIEW');
      if (next) inputRefs.current[next.id]?.focus();
    } finally {
      setSaving(null);
    }
  };

  // Auto-focus first pending on filter change
  useEffect(() => {
    const firstPending = filtered.find((l) => l.status === 'PENDING' || l.status === 'RECOUNT_NEEDED' || l.status === 'REQUIRES_REVIEW');
    if (firstPending) inputRefs.current[firstPending.id]?.focus();
  }, [filter, filtered]);

  const filterLabels: Record<string, string> = {
    ALL: t('inventory_count.sheet.filter_all'),
    PENDING: t('inventory_count.sheet.filter_pending'),
    RECOUNT: t('inventory_count.sheet.filter_recount'),
    REVIEW: t('inventory_count.sheet.filter_review'),
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex-1 sm:flex-none">
            <label htmlFor="count-search" className="sr-only">{t('inventory_count.sheet.search_label')}</label>
            <input
              id="count-search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={t('inventory_count.sheet.search_placeholder')}
              className="pos-input w-full sm:w-[320px] pl-9"
              aria-label={t('inventory_count.sheet.search_label')}
            />
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-ink-muted)' }} aria-hidden>
              <SearchIcon size={16} />
            </span>
          </div>
          <span className="hidden shrink-0 text-xs tabular-nums sm:inline" style={{ color: 'var(--color-ink-muted)' }} aria-live="polite">{t('inventory_count.sheet.count_label', { filtered: filtered.length, total })}</span>
        </div>

        <div
          role="tablist"
          aria-label={t('inventory_count.sheet.filter_all', { defaultValue: 'Filtros de líneas' })}
          className="flex items-center gap-1.5 rounded-full p-1 shrink-0 overflow-x-auto"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        >
          {(['ALL', 'PENDING', 'RECOUNT', 'REVIEW'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              aria-label={filterLabels[f]}
              onClick={() => onFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pharma)] ${filter === f ? 'bg-white shadow-sm' : 'hover:bg-white/60'}`}
              style={{ color: filter === f ? 'var(--color-ink)' : 'var(--color-ink-muted)' }}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop table — hidden on mobile */}
      <div className="hidden sm:flex min-h-0 flex-1 flex-col overflow-auto rounded-xl border" style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 10%, transparent)', backgroundColor: 'var(--color-panel)' }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'color-mix(in srgb, var(--color-surface) 86%, white)' }}>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>
              <th className="px-3 py-2.5 font-semibold">{t('inventory_count.sheet.header_product')}</th>
              <th className="px-3 py-2.5 font-semibold">{t('inventory_count.sheet.header_lot')}</th>
              <th className="px-3 py-2.5 font-semibold text-center">
                <span className="inline-flex items-center gap-1">{mode === 'BLIND' ? <><EyeIcon size={12} aria-hidden /> {t('inventory_count.sheet.header_theoretical_hidden')}</> : t('inventory_count.sheet.header_theoretical')}</span>
              </th>
              <th className="px-3 py-2.5 font-semibold text-center">{t('inventory_count.sheet.header_count')}</th>
              <th className="px-3 py-2.5 font-semibold text-center">{t('inventory_count.sheet.header_difference')}</th>
              <th className="px-3 py-2.5 font-semibold text-right">{t('inventory_count.sheet.header_action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-14 text-center text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                  <div className="mx-auto max-w-[360px] space-y-2">
                    <p className="font-medium" style={{ color: 'var(--color-ink)' }}>{t('common.no_results', { defaultValue: 'Sin resultados' })}</p>
                    <p className="text-xs leading-relaxed">{t('inventory_count.sheet.empty')}</p>
                  </div>
                </td>
              </tr>
            )}
            <AnimatePresence initial={false}>
              {filtered.map((line) => {
                const diff = line.difference;
                const diffColor = diff == null ? 'var(--color-ink-muted)' : diff === 0 ? 'var(--color-success)' : 'var(--color-warning)';
                const rowBg = line.requiresRecount ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)' : line.status === 'REQUIRES_REVIEW' ? 'color-mix(in srgb, var(--color-error) 6%, transparent)' : 'transparent';
                const showTheoretical = mode === 'INFORMED' || line.status === 'RESOLVED' || line.status === 'REQUIRES_REVIEW' || (line.countedQty1 != null && line.requiresRecount === false);
                const isFlashing = savedFlash === line.id;
                return (
                  <motion.tr
                    key={line.id}
                    layout={!reduce}
                    initial={reduce ? undefined : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    className="border-t"
                    style={{ backgroundColor: isFlashing ? 'color-mix(in srgb, var(--color-pharma) 8%, transparent)' : rowBg, borderColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {line.isHighValue && <span title={t('inventory_count.sheet.high_value')} aria-label={t('inventory_count.sheet.high_value')} className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-warning)' }} />}
                        <div className="min-w-0">
                          <p className="truncate font-medium leading-tight" style={{ color: 'var(--color-ink)' }}>{line.productName}</p>
                          <p className="flex items-center gap-1 text-xs truncate" style={{ color: 'var(--color-ink-muted)' }}>
                            {line.internalCode && <span className="font-data tabular-nums">{line.internalCode}</span>}
                            {line.barcode && <><span className="opacity-40" aria-hidden>·</span><BarcodeIcon size={12} aria-hidden /> <span className="font-data">{line.barcode}</span></>}
                          </p>
                        </div>
                      </div>
                      {line.locationCode && <span className="mt-1 inline-flex rounded px-1.5 py-0.5 text-[11px] font-data" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)', color: 'var(--color-ink-muted)' }}>{line.locationCode}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-data text-xs font-medium tabular-nums" style={{ color: 'var(--color-ink)' }}>{line.lotCode ?? '—'}</p>
                      <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>{line.lotCode ? t('inventory_count.sheet.row_lot') : t('inventory_count.sheet.row_grouped')}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums">
                      {showTheoretical ? (
                        <span className="font-data font-semibold" style={{ color: 'var(--color-ink)' }}>{line.theoreticalQty}</span>
                      ) : (
                        <span className="tracking-widest font-data" style={{ color: 'var(--color-ink-muted)' }} aria-label={t('inventory_count.sheet.theoretical_hidden_label')}>{t('inventory_count.sheet.theoretical_hidden')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-center gap-1">
                        {line.countedQty1 != null && (
                          <span className="text-xs tabular-nums font-data" style={{ color: line.requiresRecount ? 'var(--color-warning)' : 'var(--color-ink-muted)' }}>
                            {t('inventory_count.sheet.count_c1', { value: line.countedQty1 })} {line.countedQty2 != null && <span>→ {t('inventory_count.sheet.count_c2', { value: line.countedQty2 })}</span>}
                          </span>
                        )}
                        <div className="flex items-center gap-1.5">
                          <input
                            ref={(el) => { inputRefs.current[line.id] = el; }}
                            value={localQty[line.id] ?? ''}
                            onChange={(e) => setLocalQty((m) => ({ ...m, [line.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(line); }}
                            placeholder={line.countedQty1 == null ? t('inventory_count.sheet.placeholder_count') : line.status === 'REQUIRES_REVIEW' ? t('inventory_count.sheet.placeholder_final') : t('inventory_count.sheet.placeholder_recount')}
                            inputMode="numeric"
                            aria-label={t('inventory_count.sheet.search_label')}
                            className="pos-input h-8 w-20 text-center font-data tabular-nums focus-visible:ring-1 focus-visible:ring-[var(--color-pharma)]"
                            disabled={saving === line.id}
                          />
                          <button
                            type="button"
                            onClick={() => void handleSave(line)}
                            disabled={saving === line.id || !localQty[line.id]}
                            aria-label={line.status === 'REQUIRES_REVIEW' ? t('inventory_count.sheet.set_final') : t('inventory_count.sheet.save')}
                            className="pos-button pos-button-primary h-8 px-3 text-xs disabled:opacity-40"
                          >
                            {saving === line.id ? t('inventory_count.sheet.saving') : line.status === 'REQUIRES_REVIEW' ? t('inventory_count.sheet.set_final') : line.countedQty1 == null ? t('inventory_count.sheet.save') : t('inventory_count.sheet.recount')}
                          </button>
                        </div>
                        {line.finalQty != null && line.status === 'RESOLVED' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-success)' }}><CheckCircleIcon size={12} aria-hidden /> {t('inventory_count.sheet.final', { value: line.finalQty })}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center font-data tabular-nums">
                      {diff == null ? (
                        <span style={{ color: 'var(--color-ink-muted)' }}>—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold" style={{ color: diffColor }}>
                          {diff === 0 ? <><CheckCircleIcon size={14} aria-hidden /> 0</> : diff > 0 ? `+${diff}` : `${diff}`}
                          {diff !== 0 && line.isHighValue && <AlertTriangleIcon size={12} aria-hidden />}
                        </span>
                      )}
                      {line.valueImpact != null && diff !== 0 && (
                        <p className="text-[11px] tabular-nums font-data" style={{ color: 'var(--color-ink-muted)' }}>${Number(line.valueImpact).toLocaleString('es-CO')}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex rounded-full px-2 py-1 text-[11px] font-semibold" style={{
                        backgroundColor: line.status === 'PENDING' ? 'color-mix(in srgb, var(--color-ink) 8%, transparent)' : line.status === 'COUNTED' ? 'var(--color-success-container)' : line.status === 'RECOUNT_NEEDED' ? 'color-mix(in srgb, var(--color-warning) 14%, transparent)' : line.status === 'RESOLVED' ? 'var(--color-success-container)' : 'var(--color-error-container)',
                        color: line.status === 'PENDING' ? 'var(--color-ink-muted)' : line.status === 'COUNTED' ? 'var(--color-success)' : line.status === 'RECOUNT_NEEDED' ? '#92400E' : line.status === 'RESOLVED' ? 'var(--color-success)' : 'var(--color-error)',
                      }}>
                        {line.status === 'PENDING' ? t('inventory_count.sheet.status_pending') : line.status === 'COUNTED' ? t('inventory_count.sheet.status_counted') : line.status === 'RECOUNT_NEEDED' ? t('inventory_count.sheet.status_recount_needed') : line.status === 'RECOUNTED' ? t('inventory_count.sheet.status_recounted') : line.status === 'RESOLVED' ? t('inventory_count.sheet.status_resolved') : t('inventory_count.sheet.status_review')}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Mobile cards — visible below sm */}
      <div className="flex sm:hidden min-h-0 flex-1 flex-col gap-3 overflow-auto pb-2">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 12%, transparent)', backgroundColor: 'var(--color-panel)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('common.no_results', { defaultValue: 'Sin resultados' })}</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.sheet.empty')}</p>
          </div>
        )}
        {filtered.map((line) => {
          const diff = line.difference;
          const showTheoretical = mode === 'INFORMED' || line.status === 'RESOLVED' || line.status === 'REQUIRES_REVIEW' || (line.countedQty1 != null && line.requiresRecount === false);
          return (
            <div key={line.id} className="pos-panel p-3 flex flex-col gap-3" style={{ borderLeft: line.requiresRecount ? '3px solid var(--color-warning)' : line.status === 'REQUIRES_REVIEW' ? '3px solid var(--color-error)' : '3px solid transparent' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium leading-tight truncate" style={{ color: 'var(--color-ink)' }}>{line.productName}</p>
                  <p className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--color-ink-muted)' }}>{line.internalCode} {line.barcode && <>· <BarcodeIcon size={10} /> {line.barcode}</>}</p>
                  <p className="font-data text-xs mt-1" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.sheet.row_lot')} {line.lotCode ?? '—'} {line.locationCode && <span style={{ color: 'var(--color-ink-muted)' }}>· {line.locationCode}</span>}</p>
                </div>
                <span className="inline-flex rounded-full px-2 py-1 text-[11px] font-semibold shrink-0" style={{
                  backgroundColor: line.status === 'PENDING' ? 'color-mix(in srgb, var(--color-ink) 8%, transparent)' : line.status === 'REQUIRES_REVIEW' ? 'var(--color-error-container)' : 'var(--color-success-container)',
                  color: line.status === 'PENDING' ? 'var(--color-ink-muted)' : line.status === 'REQUIRES_REVIEW' ? 'var(--color-error)' : 'var(--color-success)',
                }}>{line.status === 'PENDING' ? t('inventory_count.sheet.status_pending') : line.status === 'REQUIRES_REVIEW' ? t('inventory_count.sheet.status_review') : line.status}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.sheet.header_theoretical')} {showTheoretical ? <b className="font-data" style={{ color: 'var(--color-ink)' }}>{line.theoreticalQty}</b> : <span className="tracking-widest" aria-label={t('inventory_count.sheet.theoretical_hidden_label')}>{t('inventory_count.sheet.theoretical_hidden')}</span>}</span>
                {diff != null && <span className="font-data font-semibold tabular-nums" style={{ color: diff === 0 ? 'var(--color-success)' : 'var(--color-warning)' }}>{diff === 0 ? '0' : diff > 0 ? `+${diff}` : diff} dif.</span>}
              </div>
              {line.countedQty1 != null && <p className="text-xs font-data tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.sheet.count_c1', { value: line.countedQty1 })}{line.countedQty2 != null && ` → ${t('inventory_count.sheet.count_c2', { value: line.countedQty2 })}`} {line.finalQty != null && `· ${t('inventory_count.sheet.final', { value: line.finalQty })}`}</p>}
              <div className="flex items-center gap-2">
                <input
                  ref={(el) => { inputRefs.current[`${line.id}-m`] = el; }}
                  value={localQty[line.id] ?? ''}
                  onChange={(e) => setLocalQty((m) => ({ ...m, [line.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(line); }}
                  placeholder={line.countedQty1 == null ? t('inventory_count.sheet.placeholder_count') : t('inventory_count.sheet.placeholder_recount')}
                  inputMode="numeric"
                  aria-label={`${t('inventory_count.sheet.header_count')} ${line.productName}`}
                  className="pos-input h-10 flex-1 text-center font-data tabular-nums text-base"
                />
                <button
                  type="button"
                  onClick={() => void handleSave(line)}
                  disabled={saving === line.id || !localQty[line.id]}
                  className="pos-button pos-button-primary h-10 px-5 shrink-0 disabled:opacity-40"
                >
                  {saving === line.id ? t('inventory_count.sheet.saving') : line.status === 'REQUIRES_REVIEW' ? t('inventory_count.sheet.set_final') : t('inventory_count.sheet.save')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="pt-3 text-center text-xs hidden sm:block" style={{ color: 'var(--color-ink-muted)' }}>
        {t('inventory_count.sheet.hint')}
      </p>
    </div>
  );
};
