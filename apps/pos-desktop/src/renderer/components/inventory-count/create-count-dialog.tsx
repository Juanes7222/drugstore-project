/**
 * CreateCountDialog — wizard ligero para crear borrador de reconteo.
 * Motion sutil en steps, focus trap nativo, Enter para crear, Escape para cerrar.
 */
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { XIcon, PackageIcon, ClipboardListIcon } from '@/components/ui/icons';

export type CreateCountForm = {
  name: string;
  scopeType: 'FULL' | 'CATEGORY' | 'LABORATORY';
  scopeValue: string | null;
  scopeLabel: string | null;
  mode: 'BLIND' | 'INFORMED';
  tolerancePercent: number;
  requireDoubleCount: boolean;
  notes: string | null;
};

export const CreateCountDialog: FC<{
  open: boolean;
  onClose: () => void;
  onCreate: (form: CreateCountForm) => Promise<void>;
  categories?: Array<{ id: string; name: string }>;
}> = ({ open, onClose, onCreate, categories }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateCountForm>({
    name: '',
    scopeType: 'FULL',
    scopeValue: null,
    scopeLabel: null,
    mode: 'BLIND',
    tolerancePercent: 2,
    requireDoubleCount: true,
    notes: null,
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const primaryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setLoading(false);
      setStep(1);
      setTimeout(() => primaryRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const submit = async () => {
    if (form.scopeType === 'CATEGORY' && !form.scopeValue) { setError(t('inventory_count.dialog.error_create')); return; }
    if (form.scopeType === 'LABORATORY' && !form.scopeValue?.trim()) { setError(t('inventory_count.dialog.error_create')); return; }
    setLoading(true);
    setError(null);
    try {
      await onCreate(form);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('inventory_count.dialog.error_create'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-count-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={reduce ? undefined : { opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="pos-panel w-full max-w-[560px] max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between p-6 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ backgroundColor: 'var(--color-pharma)', color: 'white' }} aria-hidden>
              <ClipboardListIcon size={20} />
            </span>
            <div>
              <h2 id="create-count-title" className="text-lg font-semibold leading-none" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.title')}</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.dialog.subtitle')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pharma)]" aria-label={t('common.close')}>
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-6 pb-3" aria-hidden>
          <span className="h-1.5 flex-1 rounded-full transition-colors" style={{ backgroundColor: step >= 1 ? 'var(--color-pharma)' : 'color-mix(in srgb, var(--color-ink) 10%, transparent)' }} />
          <span className="h-1.5 flex-1 rounded-full transition-colors" style={{ backgroundColor: step >= 2 ? 'var(--color-pharma)' : 'color-mix(in srgb, var(--color-ink) 10%, transparent)' }} />
        </div>

        <div className="overflow-auto px-6 pb-6 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            {step === 1 ? (
              <motion.div
                key="s1"
                initial={reduce ? undefined : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, x: -12 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.name')} <span className="font-normal" style={{ color: 'var(--color-ink-muted)' }}>({t('common.optional')})</span></span>
                  <input
                    ref={primaryRef}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t('inventory_count.dialog.name_placeholder')}
                    className="pos-input w-full"
                    aria-label={t('inventory_count.dialog.name')}
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.scope')}</span>
                    <select
                      value={form.scopeType}
                      onChange={(e) => {
                        const v = e.target.value as CreateCountForm['scopeType'];
                        setForm((f) => ({ ...f, scopeType: v, scopeValue: null, scopeLabel: null }));
                      }}
                      className="pos-input w-full"
                      aria-label={t('inventory_count.dialog.scope')}
                    >
                      <option value="FULL">{t('inventory_count.dialog.scope_full')}</option>
                      <option value="CATEGORY">{t('inventory_count.dialog.scope_category')}</option>
                      <option value="LABORATORY">{t('inventory_count.dialog.scope_laboratory')}</option>
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.mode')}</span>
                    <select
                      value={form.mode}
                      onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as any }))}
                      className="pos-input w-full"
                      aria-label={t('inventory_count.dialog.mode')}
                    >
                      <option value="BLIND">{t('inventory_count.dialog.mode_blind')}</option>
                      <option value="INFORMED">{t('inventory_count.dialog.mode_informed')}</option>
                    </select>
                  </label>
                </div>

                {form.scopeType === 'CATEGORY' && (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.category')} <span aria-hidden className="text-[11px] font-normal" style={{ color: 'var(--color-error)' }}>*</span></span>
                    <select
                      value={form.scopeValue ?? ''}
                      onChange={(e) => {
                        const cat = categories?.find((c) => c.id === e.target.value);
                        setForm((f) => ({ ...f, scopeValue: e.target.value || null, scopeLabel: cat?.name ?? null }));
                      }}
                      className="pos-input w-full"
                      aria-label={t('inventory_count.dialog.category')}
                    >
                      <option value="">{t('inventory_count.dialog.category_placeholder')}</option>
                      {(categories ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )}

                {form.scopeType === 'LABORATORY' && (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.laboratory')} <span aria-hidden className="text-[11px] font-normal" style={{ color: 'var(--color-error)' }}>*</span></span>
                    <input
                      value={form.scopeValue ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value || null, scopeLabel: e.target.value || null }))}
                      placeholder={t('inventory_count.dialog.laboratory_placeholder')}
                      className="pos-input w-full"
                      aria-label={t('inventory_count.dialog.laboratory')}
                    />
                    <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.dialog.laboratory_hint')}</span>
                  </label>
                )}

                <div className="flex justify-end pt-2">
                  <button type="button" onClick={() => setStep(2)} className="pos-button pos-button-primary">
                    {t('common.next')}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="s2"
                initial={reduce ? undefined : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, x: 12 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'color-mix(in srgb, var(--color-pharma) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-pharma) 12%, transparent)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.double_count')}</p>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.dialog.double_count_desc')}</p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center shrink-0">
                      <input type="checkbox" checked={form.requireDoubleCount} onChange={(e) => setForm((f) => ({ ...f, requireDoubleCount: e.target.checked }))} className="peer sr-only" aria-label={t('inventory_count.dialog.double_count')} />
                      <span className="peer h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:bg-[var(--color-pharma)]" />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.dialog.tolerance')}</span>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={1}
                        value={form.tolerancePercent}
                        onChange={(e) => setForm((f) => ({ ...f, tolerancePercent: Number(e.target.value) }))}
                        className="flex-1 accent-[var(--color-pharma)]"
                        aria-label={t('inventory_count.dialog.tolerance')}
                      />
                      <span className="rounded-full px-2.5 py-1 text-sm font-semibold font-data tabular-nums shrink-0" style={{ backgroundColor: 'white', color: 'var(--color-pharma)', border: '1px solid color-mix(in srgb, var(--color-pharma) 18%, transparent)' }}>{form.tolerancePercent}%</span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>{t('inventory_count.dialog.tolerance_hint')}</span>
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{t('inventory_count.dialog.notes')} <span className="font-normal" style={{ color: 'var(--color-ink-muted)' }}>({t('common.optional')})</span></span>
                  <textarea value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))} rows={2} placeholder={t('inventory_count.dialog.notes_placeholder')} className="pos-input w-full resize-none" aria-label={t('inventory_count.dialog.notes')} />
                </label>

                {error && (
                  <div role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--color-error-container)', color: 'var(--color-error)', border: '1px solid color-mix(in srgb, var(--color-error) 16%, transparent)' }}>{error}</div>
                )}

                <div className="flex justify-between gap-2 pt-2">
                  <button type="button" onClick={() => setStep(1)} className="pos-button pos-button-secondary" disabled={loading}>{t('common.back')}</button>
                  <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="pos-button pos-button-secondary" disabled={loading}>{t('inventory_count.dialog.cancel')}</button>
                    <button type="button" onClick={() => void submit()} className="pos-button pos-button-primary min-w-[132px]" disabled={loading} aria-busy={loading}>
                      {loading ? t('inventory_count.dialog.creating') : t('inventory_count.dialog.create')}
                    </button>
                  </div>
                </div>

                <p className="text-center text-xs leading-relaxed flex items-center justify-center gap-1" style={{ color: 'var(--color-ink-muted)' }}>
                  <PackageIcon size={12} aria-hidden /> {t('inventory_count.dialog.hint')}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
