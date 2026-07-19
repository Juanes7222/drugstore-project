/**
 * Wizard step 2: declare actual cash amounts per payment method.
 *
 * Dynamic card-by-card flow:
 * - One payment method at a time, displayed as an animated card
 * - Progress bar + "Method X of N" indicator
 * - Animated transitions between methods (slide + fade)
 * - Summary card at the end before final submit
 *
 * @category Component
 */
import { type FC, useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/format-currency';
import type { ShiftSummary, CountEntry } from './types';

interface CountStepProps {
  summary: ShiftSummary;
  onSubmit: (counts: CountEntry[]) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

const cardVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 220 : -220,
    opacity: 0,
    scale: 0.94,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -220 : 220,
    opacity: 0,
    scale: 0.94,
  }),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CountStep: FC<CountStepProps> = ({
  summary,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const methods = summary.totalsByPaymentMethod;

  // Store all declared amounts: keyed by paymentMethodId
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const m of methods) {
      initial[m.paymentMethodId] = m.expectedAmount;
    }
    return initial;
  });

  // Current card index (0..methods.length means one extra "summary" card)
  const [cardIndex, setCardIndex] = useState(0);
  // +1 for forward, -1 for backward
  const directionRef = useRef(1);

  // Focus the input when card changes
  const inputRef = useRef<HTMLInputElement>(null);

  const isSummaryCard = cardIndex >= methods.length;
  const currentMethod = !isSummaryCard ? methods[cardIndex] : null;

  const progressPercent =
    methods.length === 0
      ? 100
      : Math.round((cardIndex / methods.length) * 100);

  /** Navigate forward. */
  const handleNext = useCallback(() => {
    directionRef.current = 1;
    setCardIndex((i) => i + 1);
    // Focus input on next render
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  /** Navigate backward. */
  const handlePrev = useCallback(() => {
    directionRef.current = -1;
    setCardIndex((i) => i - 1);
  }, []);

  /** Submit all counts. */
  const handleSubmit = useCallback(() => {
    const parsed = methods.map((m) => ({
      paymentMethodId: m.paymentMethodId,
      declaredAmount: Number(counts[m.paymentMethodId] ?? '0'),
    }));
    onSubmit(parsed);
  }, [methods, counts, onSubmit]);

  return (
    <div className="flex flex-col gap-pos-lg">
      <h3 className="text-body-md font-semibold">
        {t('cash_shift.wizard_count_title')}
      </h3>

      {/* Progress bar */}
      <div className="h-1 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: 'var(--color-pharma)' }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>

      {/* Card area */}
      <div className="relative min-h-[200px]">
        {methods.length === 0 ? (
          <p className="text-caption py-pos-md text-center" style={{ color: 'var(--color-ink-muted)' }}>
            {t('cash_shift.wizard_no_sales')}
          </p>
        ) : (
          <AnimatePresence mode="wait" custom={directionRef.current}>
            {!isSummaryCard && currentMethod && (
              <motion.div
                key={`method-${currentMethod.paymentMethodId}`}
                custom={directionRef.current}
                variants={cardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.85 }}
                className="rounded-pos border p-pos-lg"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'color-mix(in srgb, var(--color-ink) 12%, transparent)',
                }}
              >
                {/* Card header */}
                <div className="flex items-center justify-between mb-pos-md">
                  <span className="font-semibold text-body">
                    {currentMethod.methodName}
                  </span>
                  {currentMethod.isCash && (
                    <span
                      className="rounded-full px-2 py-0.5 text-caption font-medium"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-verified) 15%, transparent)',
                        color: 'var(--color-verified)',
                      }}
                    >
                      {t('cash_shift.cash')}
                    </span>
                  )}
                </div>

                {/* Amount input */}
                <label
                  htmlFor={`count-${currentMethod.paymentMethodId}`}
                  className="block text-caption font-medium mb-pos-xs"
                  style={{ color: 'var(--color-ink-muted)' }}
                >
                  {t('cash_shift.wizard_declared')}
                </label>
                <div className="relative">
                  <span
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-body-sm"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t('cash_shift.currency_symbol')}
                  </span>
                  <input
                    ref={inputRef}
                    id={`count-${currentMethod.paymentMethodId}`}
                    type="number"
                    min="0"
                    step="100"
                    inputMode="decimal"
                    value={counts[currentMethod.paymentMethodId] ?? ''}
                    onChange={(e) =>
                      setCounts((prev) => ({
                        ...prev,
                        [currentMethod.paymentMethodId]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleNext();
                    }}
                    className="w-full rounded-pos border px-7 py-pos-sm text-body-lg font-data tabular-nums outline-none transition-colors"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)',
                      backgroundColor: 'var(--color-panel)',
                    }}
                    autoFocus
                  />
                </div>

                {/* Expected amount hint */}
                <p className="mt-pos-xs text-caption tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>
                  {t('cash_shift.wizard_expected_short')}: {formatCurrency(Number(currentMethod.expectedAmount) * 100)}
                </p>

                {/* Navigation */}
                <div className="flex items-center justify-between mt-pos-lg">
                  <button
                    type="button"
                    onClick={handlePrev}
                    disabled={cardIndex === 0}
                    className="pos-button pos-button-ghost text-body-sm"
                  >
                    {t('common.previous')}
                  </button>
                  <span className="text-caption tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>
                    {cardIndex + 1} / {methods.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleNext}
                    className="pos-button pos-button-primary text-body-sm"
                  >
                    {cardIndex === methods.length - 1
                      ? t('cash_shift.wizard_review')
                      : t('common.next')}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Summary card — review all entered values before submit */}
            {isSummaryCard && (
              <motion.div
                key="summary-card"
                custom={directionRef.current}
                variants={cardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.85 }}
                className="rounded-pos border p-pos-lg"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'color-mix(in srgb, var(--color-ink) 12%, transparent)',
                }}
              >
                <p className="text-body-sm font-semibold mb-pos-md">
                  {t('cash_shift.wizard_count_summary')}
                </p>

                <div className="flex flex-col gap-pos-sm">
                  {methods.map((m) => {
                    const val = counts[m.paymentMethodId] ?? '0';
                    const expected = Number(m.expectedAmount);
                    const declared = Number(val);
                    const diff = declared - expected;
                    return (
                      <div key={m.paymentMethodId} className="flex items-center justify-between text-body-sm">
                        <span className="font-medium">{m.methodName}</span>
                        <span className="tabular-nums">
                          {formatCurrency(declared * 100)}
                          <span
                            className={`ml-2 text-caption ${
                              diff === 0 ? '' : diff > 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {diff >= 0 ? '+' : ''}{formatCurrency(diff * 100)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-between mt-pos-lg pt-pos-lg"
                  style={{
                    borderTop: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
                  }}
                >
                  <button type="button" onClick={handlePrev} className="pos-button pos-button-ghost text-body-sm">
                    {t('common.previous')}
                  </button>
                  <button type="button" onClick={handleSubmit} className="pos-button pos-button-primary">
                    {t('cash_shift.wizard_review')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {/* Bottom cancel — only visible when no methods */}
      {methods.length === 0 && (
        <div className="flex justify-center pt-pos-md">
          <button type="button" onClick={onCancel} className="pos-button pos-button-ghost">
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
};
