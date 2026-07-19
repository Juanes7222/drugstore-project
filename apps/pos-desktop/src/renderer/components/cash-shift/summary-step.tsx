/**
 * Wizard step 1: sales summary with expected totals per payment method.
 *
 * Animated cards with staggered entrance for the breakdown rows.
 *
 * @category Component
 */
import { type FC } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/format-currency';
import type { ShiftSummary } from './types';

interface SummaryStepProps {
  summary: ShiftSummary;
  onNext: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
} as const;

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 28 } },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SummaryStep: FC<SummaryStepProps> = ({
  summary,
  onNext,
  onCancel,
}) => {
  const { t } = useTranslation();
  return (
    <motion.div
      className="flex flex-col gap-pos-lg"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.h3 variants={item} className="text-body-md font-semibold">
        {t('cash_shift.wizard_summary_title')}
      </motion.h3>

      <motion.div
        variants={item}
        className="grid grid-cols-2 gap-pos-md rounded-pos p-pos-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-pharma) 6%, transparent)',
        }}
      >
        <div>
          <span className="block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
            {t('cash_shift.wizard_transactions')}
          </span>
          <span className="font-data tabular-nums text-body-lg font-semibold">
            {summary.transactionCount}
          </span>
        </div>
        <div>
          <span className="block text-caption font-medium" style={{ color: 'var(--color-ink-muted)' }}>
            {t('cash_shift.wizard_total_sales')}
          </span>
          <span className="font-data tabular-nums text-body-lg font-semibold">
            {formatCurrency(Number(summary.totalSalesAmount) * 100)}
          </span>
        </div>
      </motion.div>

      {/* Per-method breakdown */}
      <motion.div variants={item}>
        <span className="block text-caption font-medium mb-pos-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {t('cash_shift.wizard_per_method')}
        </span>
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)' }}>
              <th className="py-pos-xs pr-pos-md font-medium text-caption" style={{ color: 'var(--color-ink-muted)' }}>
                {t('cash_shift.wizard_method')}
              </th>
              <th className="py-pos-xs pr-pos-md font-medium text-caption text-right" style={{ color: 'var(--color-ink-muted)' }}>
                {t('cash_shift.wizard_expected')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.totalsByPaymentMethod.length === 0 && (
              <tr>
                <td colSpan={2} className="py-pos-sm text-center text-caption" style={{ color: 'var(--color-ink-muted)' }}>
                  {t('cash_shift.wizard_no_sales')}
                </td>
              </tr>
            )}
            {summary.totalsByPaymentMethod.map((m, idx) => (
              <motion.tr
                key={m.paymentMethodId}
                variants={item}
                custom={idx}
                className="hover:opacity-80"
                style={{
                  borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 5%, transparent)',
                }}
              >
                <td className="py-pos-xs pr-pos-md font-data">
                  {m.methodName}
                  {m.isCash && (
                    <span className="ml-pos-xs text-caption" style={{ color: 'var(--color-ink-muted)' }}>
                      ({t('cash_shift.cash')})
                    </span>
                  )}
                </td>
                <td className="py-pos-xs font-data tabular-nums text-right">
                  {formatCurrency(Number(m.expectedAmount) * 100)}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </motion.div>

      <motion.div
        variants={item}
        className="flex justify-between border-t pt-pos-lg"
        style={{
          borderColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
        }}
      >
        <button type="button" onClick={onCancel} className="pos-button pos-button-ghost">
          {t('common.cancel')}
        </button>
        <button type="button" onClick={onNext} className="pos-button pos-button-primary">
          {t('cash_shift.wizard_next')}
        </button>
      </motion.div>
    </motion.div>
  );
};
