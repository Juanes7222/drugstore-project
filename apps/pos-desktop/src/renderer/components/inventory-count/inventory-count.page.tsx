/**
 * InventoryCountPage — reconteo completo de inventario.
 * Orquesta servicio; todo el markup presentacional vive en sub-componentes locales + count-sheet / session-card.
 * Blind default, tolerancia 2%, doble conteo inteligente, snapshot inmutable, cierre genera ajuste único.
 */
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useInventoryCountService, useServiceContext } from '../common/service-context';
import { useAppDispatch } from '@/store/hooks';
import { navigateBackToSales } from '@/store/slices/ui-slice';
import { notify } from '@/utils/notify';
import { PlusIcon, ArrowLeftIcon, PackageIcon, ScaleIcon, ClipboardListIcon, CheckCircleIcon, AlertTriangleIcon, RefreshCwIcon } from '@/components/ui/icons';
import { SessionCard } from './session-card';
import { CreateCountDialog, type CreateCountForm } from './create-count-dialog';
import { CountSheet } from './count-sheet';
import { StatusBadge } from './status-badge';
import { ProgressBar } from './progress-bar';
import type { CountLineDto, CountSessionDto } from '../../../domain/inventory-count';

// ── Small presentational helpers (kept in page to keep file thin, no business logic) ──

const ErrorAlert: FC<{ message: string; onDismiss?: () => void }> = ({ message, onDismiss }) => {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-sm" style={{ backgroundColor: 'var(--color-error-container)', color: 'var(--color-error)', border: '1px solid color-mix(in srgb, var(--color-error) 14%, transparent)' }}>
      <span className="flex items-center gap-2"><AlertTriangleIcon size={14} aria-hidden /> {message}</span>
      {onDismiss && <button type="button" onClick={onDismiss} className="text-xs underline shrink-0" style={{ color: 'var(--color-error)' }}>{t('common.close')}</button>}
    </div>
  );
};

const SkeletonCard: FC = () => (
  <div className="pos-panel p-4 space-y-3 animate-pulse">
    <div className="flex justify-between"><div className="h-4 w-28 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }} /><div className="h-5 w-20 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }} /></div>
    <div className="h-3 w-full rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }} />
    <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }} />
  </div>
);

const DraftPlaceholder: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-pharma) 10%, transparent)', color: 'var(--color-pharma)' }} aria-hidden><PackageIcon size={24} /></span>
      <p className="max-w-[420px] text-sm leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
        {t('inventory_count.detail.draft.desc')}
      </p>
      <div className="rounded-lg px-3 py-2 text-xs text-left max-w-[420px]" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 16%, transparent)', color: '#92400E' }}>
        <AlertTriangleIcon size={12} className="inline mr-1" aria-hidden /> {t('inventory_count.detail.draft.warning')}
      </div>
    </div>
  );
};

const ConfirmDialog: FC<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, description, confirmLabel, variant = 'primary', loading, onConfirm, onCancel }) => {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="pos-panel w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className="text-base font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="pos-button pos-button-secondary" disabled={!!loading}>{t('common.cancel')}</button>
          <button
            type="button"
            onClick={onConfirm}
            className={`pos-button ${variant === 'danger' ? '' : 'pos-button-primary'}`}
            style={variant === 'danger' ? { backgroundColor: 'var(--color-error)', color: 'white' } : undefined}
            disabled={!!loading}
            aria-busy={!!loading}
          >
            {loading ? t('inventory_count.detail.processing') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const InventoryCountPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const service = useInventoryCountService();
  const syncSvc = useServiceContext();
  const reduce = useReducedMotion();

  // List
  const [sessions, setSessions] = useState<CountSessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);

  // Detail
  const [detail, setDetail] = useState<CountSessionDto | null>(null);
  const [lines, setLines] = useState<CountLineDto[]>([]);
  const [totalLines, setTotalLines] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'RECOUNT' | 'REVIEW'>('ALL');
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const list = await service.listSessions(30);
      setSessions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.unexpected_error'));
    } finally {
      setLoading(false);
    }
  }, [service, t]);

  const loadCategories = useCallback(async () => {
    try {
      const { getLocalDatabase } = await import('../../../infrastructure/local-database');
      const { prisma } = (await getLocalDatabase()) as any;
      if (prisma?.category) {
        const cats = await prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 });
        setCategories(cats);
      }
    } catch { /* ignore — free-text laboratorio works */ }
  }, []);

  useEffect(() => { void loadSessions(); void loadCategories(); }, [loadSessions, loadCategories]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const s = await service.getSession(id);
      setDetail(s);
      const { items, total } = await service.listLines(id, { take: 5000 });
      setLines(items);
      setTotalLines(total);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('inventory_count.detail.error_load_detail'));
    } finally {
      setDetailLoading(false);
    }
  }, [service, t]);

  const refreshLines = useCallback(async () => {
    if (!detail) return;
    const { items, total } = await service.listLines(detail.id, {
      search: search.trim() || undefined,
      take: 5000,
      ...(filter === 'PENDING' ? { status: 'PENDING' as const } : {}),
      ...(filter === 'RECOUNT' ? { onlyRecount: true } : {}),
      ...(filter === 'REVIEW' ? { status: 'REQUIRES_REVIEW' as const } : {}),
    });
    let filteredItems = items;
    if (filter === 'RECOUNT') filteredItems = items.filter((l) => l.requiresRecount);
    if (filter === 'REVIEW') filteredItems = items.filter((l) => l.status === 'REQUIRES_REVIEW');
    setLines(filteredItems);
    setTotalLines(total);
    const fresh = await service.getSession(detail.id);
    setDetail(fresh);
    setSessions((prev) => prev.map((s) => (s.id === fresh.id ? fresh : s)));
  }, [detail, filter, search, service]);

  useEffect(() => { if (detail) void refreshLines(); }, [filter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fix sync for already-closed counts that failed before the PHYSICAL_COUNT patch
  // — same code as handleClose, but runs silently when you open the detail.
  useEffect(() => {
    if (detail?.state !== 'CLOSED') return;
    void (async () => {
      try {
        const st = await service.getSyncStatus(detail.id);
        if (st && ['FAILED', 'PERMANENT_FAILURE'].includes(st.status)) {
          await service.fixAndResync(detail.id);
          await syncSvc.syncScheduler.syncNow();
        }
      } catch { /* handled in sync-health if still failing */ }
    })();
  }, [detail?.id, detail?.state, service, syncSvc.syncScheduler]);

  const handleCreate = async (form: CreateCountForm) => {
    const created = await service.createSession({
      name: form.name || undefined,
      scopeType: form.scopeType as any,
      scopeValue: form.scopeValue,
      scopeLabel: form.scopeLabel,
      mode: form.mode as any,
      tolerancePercent: form.tolerancePercent,
      requireDoubleCount: form.requireDoubleCount,
      notes: form.notes,
    });
    setSessions((prev) => [created, ...prev]);
    setSelectedId(created.id);
    await loadDetail(created.id);
    notify.success({ title: t('inventory_count.detail.toast_draft_created'), description: created.code });
  };

  const handleStart = async () => {
    if (!detail) return;
    setActionLoading('start');
    setError(null);
    try {
      const started = await service.startSession(detail.id);
      setDetail(started);
      setSessions((prev) => prev.map((s) => (s.id === started.id ? started : s)));
      const { items, total } = await service.listLines(started.id, { take: 5000 });
      setLines(items);
      setTotalLines(total);
      notify.success({ title: t('inventory_count.detail.toast_count_started'), description: t('inventory_count.detail.toast_count_started_desc', { total }) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.unexpected_error');
      if (msg.includes('upsert')) {
        setError(t('common.unexpected_error') + ' ' + msg);
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleRecord = async (lineId: string, qty: number) => {
    try {
      await service.recordCount(lineId, qty);
      await refreshLines();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.unexpected_error'));
    }
  };

  const handleSetFinal = async (lineId: string, qty: number) => {
    try {
      await service.setFinalQty(lineId, qty);
      await refreshLines();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.unexpected_error'));
    }
  };

  const handleEvaluate = async () => {
    if (!detail) return;
    setActionLoading('eval');
    try {
      const r = await service.evaluateRecounts(detail.id);
      await refreshLines();
      notify.success({ title: t('inventory_count.detail.toast_recounted'), description: t('inventory_count.detail.toast_recounted_desc', { count: r.marked }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.unexpected_error'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleMoveToReview = async () => {
    if (!detail) return;
    setActionLoading('review');
    setError(null);
    try {
      const moved = await service.moveToReview(detail.id);
      setDetail(moved);
      setSessions((prev) => prev.map((s) => (s.id === moved.id ? moved : s)));
      notify.success({ title: t('inventory_count.detail.toast_in_review'), description: t('inventory_count.detail.toast_in_review_desc') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.unexpected_error');
      setError(msg);
      if (msg.includes('pending') || msg.includes('recount') || msg.includes('blocking') || msg.includes('PENDING') || msg.includes('RECOUNT')) {
        const needsRecount = msg.toLowerCase().includes('recount');
        setSearch('');
        setFilter(needsRecount ? 'RECOUNT' : 'PENDING');
        try {
          const { items } = await service.listLines(detail.id, {
            take: 5000,
            ...(needsRecount ? { onlyRecount: true } : { status: 'PENDING' as const }),
          });
          const filtered = needsRecount ? items.filter((l) => l.requiresRecount) : items;
          setLines(filtered);
          notify.warning({ title: t(needsRecount ? 'inventory_count.detail.missing_recounts' : 'inventory_count.detail.missing_counts'), description: t('inventory_count.detail.missing_counts_desc', { count: filtered.length }) });
        } catch { /* error already shown */ }
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleClose = async () => {
    if (!detail) return;
    setConfirmCloseOpen(false);
    setActionLoading('close');
    setError(null);
    try {
      const closed = await service.closeSession(detail.id);
      setDetail(closed);
      setSessions((prev) => prev.map((s) => (s.id === closed.id ? closed : s)));
      notify.success({ title: t('inventory_count.detail.toast_closed'), description: `${closed.code} — ${closed.discrepancyCount} ${t('inventory_count.detail.in_review.discrepancies', { count: closed.discrepancyCount })}` });
      // Reuse same sync pipeline as sales/inventory-adjustments: after confirming adjustment,
      // the SyncQueue entry is already enqueued with notifyPendingEntry(). Trigger immediate push
      // from the same inventory window so the server sees the stock without extra UI.
      try {
        // Fix any pre-patch payload that may still be FAILED (PHYSICAL_COUNT mapping bug)
        const st = await service.getSyncStatus(closed.id).catch(() => null);
        if (st && ['FAILED', 'PERMANENT_FAILURE'].includes(st.status)) {
          await service.fixAndResync(closed.id).catch(() => null);
        }
        await syncSvc.syncScheduler.syncNow();
      } catch { /* sync errors are surfaced in sync-health, not here */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.unexpected_error'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!detail) return;
    setConfirmCancelOpen(false);
    setActionLoading('cancel');
    try {
      const c = await service.cancelSession(detail.id);
      setDetail(c);
      setSessions((prev) => prev.map((s) => (s.id === c.id ? c : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.unexpected_error'));
    } finally {
      setActionLoading(null);
    }
  };

  const progressPercent = detail && detail.totalLines ? Math.round((detail.countedLines / detail.totalLines) * 100) : 0;

  const summary = useMemo(() => {
    if (!detail) return null;
    const discrepant = lines.filter((l) => (l.difference ?? 0) !== 0);
    const faltantes = discrepant.filter((l) => (l.difference ?? 0) < 0);
    const sobrantes = discrepant.filter((l) => (l.difference ?? 0) > 0);
    const valueImpact = lines.reduce((acc, l) => acc + Number(l.valueImpact ?? 0), 0);
    return { discrepant: discrepant.length, faltantes: faltantes.length, sobrantes: sobrantes.length, valueImpact };
  }, [lines, detail]);

  const activeSessions = useMemo(() => sessions.filter((s) => s.state === 'IN_PROGRESS' || s.state === 'IN_REVIEW'), [sessions]);
  const historySessions = useMemo(() => sessions.filter((s) => s.state !== 'IN_PROGRESS' && s.state !== 'IN_REVIEW'), [sessions]);

  if (selectedId && detail) {
    const scopeLabel = detail.scopeType === 'FULL' ? t('inventory_count.detail.scope_full') : (detail.scopeLabel ?? detail.scopeValue ?? detail.scopeType);
    const modeLabel = detail.mode === 'BLIND' ? t('inventory_count.detail.mode_blind') : t('inventory_count.detail.mode_informed');
    const fallbackName = t('inventory_count.detail.fallback_name');
    return (
      <section className="flex h-full flex-col" style={{ backgroundColor: 'var(--color-surface)' }} aria-label={`${t('inventory_count.title')} ${detail.code}`}>
        <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6 shrink-0" style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)', backgroundColor: 'var(--color-panel)' }}>
          <button type="button" onClick={() => setSelectedId(null)} className="pos-button pos-button-secondary h-9 px-3 shrink-0" aria-label={t('inventory_count.detail.back_to_list')}>
            <ArrowLeftIcon size={16} aria-hidden /> {t('inventory_count.detail.back_to_list')}
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <span className="hidden h-9 w-9 items-center justify-center rounded-xl sm:flex shrink-0" style={{ backgroundColor: 'var(--color-pharma)', color: 'white' }} aria-hidden>
              <ClipboardListIcon size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="truncate text-base font-semibold font-data tabular-nums" style={{ color: 'var(--color-ink)' }}>{detail.code}</h1>
                <StatusBadge state={detail.state} />
              </div>
              <p className="truncate text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                {detail.name ?? fallbackName} · {scopeLabel} · {modeLabel}
              </p>
            </div>
          </div>
          <div className="ml-auto hidden items-center gap-3 sm:flex shrink-0">
            <div className="text-right">
              <p className="text-xs font-data tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.detail.counted_of', { counted: detail.countedLines, total: detail.totalLines, discrepancies: detail.discrepancyCount })}</p>
              <div className="w-[160px] mt-1"><ProgressBar percent={progressPercent} size="sm" label={t('inventory_count.detail.progress', { percent: progressPercent })} /></div>
            </div>
          </div>
        </header>

        {error && (
          <div className="mx-4 mt-3 sm:mx-6"><ErrorAlert message={error} onDismiss={() => setError(null)} /></div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 rounded-xl p-3 shrink-0" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)' }}>
            {detail.state === 'DRAFT' && (
              <>
                <button type="button" onClick={handleStart} disabled={actionLoading === 'start'} className="pos-button pos-button-primary" aria-busy={actionLoading === 'start'}>
                  <PackageIcon size={16} aria-hidden /> {t('inventory_count.detail.draft.start')}
                </button>
                <span className="text-xs hidden sm:inline" style={{ color: 'var(--color-ink-muted)' }}>{detail.totalLines ? t('inventory_count.detail.draft.start_hint', { lines: `${detail.totalLines} ${t('common.completed')}` }) : t('inventory_count.detail.draft.start_hint_generic')}</span>
                <button type="button" onClick={() => setConfirmCancelOpen(true)} className="ml-auto text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pharma)]" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.detail.draft.cancel')}</button>
              </>
            )}
            {detail.state === 'IN_PROGRESS' && (
              <>
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-ink)' }}>
                  <ScaleIcon size={16} aria-hidden /> <b className="font-data tabular-nums">{detail.countedLines}</b> {t('inventory_count.detail.in_progress.counted', { count: detail.countedLines })} · <b className="font-data tabular-nums">{lines.filter((l) => l.requiresRecount).length}</b> {t('inventory_count.detail.in_progress.recount_needed', { count: lines.filter((l) => l.requiresRecount).length })}
                </div>
                <div className="ml-auto flex gap-2">
                  <button type="button" onClick={handleEvaluate} disabled={actionLoading === 'eval'} className="pos-button pos-button-secondary h-8 text-xs" aria-busy={actionLoading === 'eval'}>
                    <RefreshCwIcon size={14} aria-hidden /> {t('inventory_count.detail.in_progress.reevaluate')}
                  </button>
                  <button type="button" onClick={handleMoveToReview} disabled={actionLoading === 'review'} className="pos-button pos-button-primary h-8 text-xs" aria-busy={actionLoading === 'review'}>
                    {t('inventory_count.detail.in_progress.move_to_review')} <CheckCircleIcon size={14} aria-hidden />
                  </button>
                </div>
              </>
            )}
            {detail.state === 'IN_REVIEW' && summary && (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full px-2.5 py-1 font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: '#92400E' }}>{t('inventory_count.detail.in_review.discrepancies', { count: summary.discrepant })}</span>
                  <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: 'var(--color-error-container)', color: 'var(--color-error)' }}>{t('inventory_count.detail.in_review.missing', { count: summary.faltantes })}</span>
                  <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: 'var(--color-success-container)', color: 'var(--color-success)' }}>{t('inventory_count.detail.in_review.surplus', { count: summary.sobrantes })}</span>
                  <span className="rounded-full px-2.5 py-1 font-data tabular-nums" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)', color: 'var(--color-ink)' }}>{t('inventory_count.detail.in_review.impact', { value: summary.valueImpact.toLocaleString('es-CO') })}</span>
                </div>
                <div className="ml-auto flex gap-2">
                  <button type="button" onClick={() => loadDetail(detail.id)} className="pos-button pos-button-secondary h-8 text-xs">{t('inventory_count.detail.in_review.update')}</button>
                  <button type="button" onClick={() => setConfirmCloseOpen(true)} disabled={actionLoading === 'close'} className="pos-button pos-button-primary h-8 text-xs" aria-busy={actionLoading === 'close'}>
                    <CheckCircleIcon size={14} aria-hidden /> {t('inventory_count.detail.in_review.close')}
                  </button>
                </div>
              </>
            )}
            {(detail.state === 'CLOSED' || detail.state === 'CANCELLED') && (
              <div className="flex w-full items-center justify-between gap-3 text-sm flex-wrap" style={{ color: 'var(--color-ink-muted)' }}>
                <span>{detail.state === 'CLOSED' ? t('inventory_count.detail.in_review.closed_msg') : t('inventory_count.detail.in_review.cancelled_msg')} {detail.closedAt ? new Date(detail.closedAt).toLocaleString('es-CO') : ''}</span>
                <span className="font-data tabular-nums" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.detail.in_review.impact', { value: Number(detail.totalValueImpact ?? 0).toLocaleString('es-CO') })}</span>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 rounded-xl p-3 sm:p-4 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)' }}>
            {detailLoading ? (
              <div className="flex h-full items-center justify-center text-sm gap-2" style={{ color: 'var(--color-ink-muted)' }} aria-live="polite" aria-busy="true">
                <RefreshCwIcon size={16} className="animate-spin" aria-hidden /> {t('inventory_count.detail.loading_lines')}
              </div>
            ) : detail.state === 'DRAFT' ? (
              <DraftPlaceholder />
            ) : (
              <CountSheet
                lines={lines}
                total={totalLines}
                mode={detail.mode as any}
                onRecord={handleRecord}
                onSetFinal={handleSetFinal}
                onSearch={setSearch}
                search={search}
                filter={filter}
                onFilter={setFilter}
              />
            )}
          </div>
        </div>

        <ConfirmDialog
          open={confirmCloseOpen}
          title={t('inventory_count.detail.confirm_close_title', { code: detail.code })}
          description={t('inventory_count.detail.confirm_close_desc', { count: detail.discrepancyCount })}
          confirmLabel={t('inventory_count.detail.confirm_close_confirm')}
          variant="primary"
          loading={actionLoading === 'close'}
          onConfirm={handleClose}
          onCancel={() => setConfirmCloseOpen(false)}
        />
        <ConfirmDialog
          open={confirmCancelOpen}
          title={t('inventory_count.detail.confirm_cancel_title', { code: detail.code })}
          description={t('inventory_count.detail.confirm_cancel_desc')}
          confirmLabel={t('inventory_count.detail.confirm_cancel_confirm')}
          variant="danger"
          loading={actionLoading === 'cancel'}
          onConfirm={handleCancel}
          onCancel={() => setConfirmCancelOpen(false)}
        />
      </section>
    );
  }

  // List view
  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: 'var(--color-surface)' }} aria-label={t('inventory_count.title')}>
      <header className="flex flex-col gap-3 border-b px-4 py-4 sm:px-6 shrink-0" style={{ borderColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)', backgroundColor: 'var(--color-panel)' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3 min-w-0">
            <span className="hidden h-10 w-10 items-center justify-center rounded-xl sm:flex shrink-0" style={{ backgroundColor: 'var(--color-pharma)', color: 'white' }} aria-hidden>
              <ClipboardListIcon size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.title')}</h1>
              <p className="mt-1 max-w-[640px] text-sm leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
                {t('inventory_count.subtitle')}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setShowCreate(true)} className="pos-button pos-button-primary shrink-0" aria-label={t('inventory_count.list.new_recount')}>
            <PlusIcon size={16} aria-hidden /> {t('inventory_count.list.new_recount')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ backgroundColor: 'color-mix(in srgb, var(--color-pharma) 8%, transparent)', color: 'var(--color-pharma)', border: '1px solid color-mix(in srgb, var(--color-pharma) 16%, transparent)' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--color-pharma)' }} aria-hidden /> {t('inventory_count.badge_blind')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }}>
            {t('inventory_count.badge_tolerance')}
          </span>
          <button type="button" onClick={() => dispatch(navigateBackToSales())} className="ml-auto inline-flex items-center gap-1 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pharma)]">
            <ArrowLeftIcon size={12} aria-hidden /> {t('inventory_count.back_to_sales')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={reduce ? undefined : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </motion.div>
          ) : sessions.length === 0 ? (
            <motion.div key="empty" initial={reduce ? undefined : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--color-panel)', border: '1px dashed color-mix(in srgb, var(--color-ink) 12%, transparent)' }}>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: 'color-mix(in srgb, var(--color-pharma) 10%, transparent)', color: 'var(--color-pharma)' }} aria-hidden>
                <ClipboardListIcon size={28} />
              </span>
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.list.empty_title')}</h3>
                <p className="mx-auto mt-1 max-w-[420px] text-sm leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
                  {t('inventory_count.list.empty_desc')}
                </p>
              </div>
              <button type="button" onClick={() => setShowCreate(true)} className="pos-button pos-button-primary">
                <PlusIcon size={16} aria-hidden /> {t('inventory_count.list.create_first')}
              </button>
            </motion.div>
          ) : (
            <motion.div key="list" initial={reduce ? undefined : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} className="flex flex-col gap-6">
              {activeSessions.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.list.active', { count: activeSessions.length })}</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {activeSessions.map((s) => (
                      <SessionCard key={s.id} session={s} onOpen={() => { setSelectedId(s.id); void loadDetail(s.id); }} />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>{activeSessions.length ? t('inventory_count.list.history') : t('inventory_count.list.recounts')}</h2>
                  <span className="rounded-full px-2 py-0.5 text-xs font-data tabular-nums" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)', color: 'var(--color-ink-muted)' }}>{activeSessions.length ? historySessions.length : sessions.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(activeSessions.length ? historySessions : sessions).map((s) => (
                    <SessionCard key={s.id} session={s} onOpen={() => { setSelectedId(s.id); void loadDetail(s.id); }} />
                  ))}
                  {activeSessions.length > 0 && historySessions.length === 0 && (
                    <p className="col-span-full text-sm py-6 text-center" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.list.no_history')}</p>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <CreateCountDialog open={showCreate} onClose={() => setShowCreate(false)} onCreate={handleCreate} categories={categories} />
    </section>
  );
};
