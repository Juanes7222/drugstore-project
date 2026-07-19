/**
 * Wizard step 3: review declared amounts vs expected, with difference table
 * and final close button.
 *
 * Animated rows with staggered entrance, highlight on large differences.
 *
 * @category Component
 */
import { type FC, useMemo } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/format-currency';
import type { ShiftSummary, CountEntry } from './types';

interface ConfirmStepProps {
  summary: ShiftSummary;
  counts: CountEntry[];
  requiresStepUp: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  actionError: string | null;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

const rowItem = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 350, damping: 26 } },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ConfirmStep: FC<ConfirmStepProps> = ({
  summary,
  counts,
  requiresStepUp,
  onConfirm,
  onCancel,
  actionError,
}) => {
  const { t } = useTranslation();

  const differences = useMemo(() => {
    return summary.totalsByPaymentMethod.map((m) => {
      const count = counts.find((c) => c.paymentMethodId === m.paymentMethodId);
      const declared = count?.declaredAmount ?? 0;
      const expected = Number(m.expectedAmount);
      return {
        methodName: m.methodName,
        isCash: m.isCash,
        expected,
        declared,
        diff: declared - expected,
      };
    });
  }, [summary, counts]);

  const totalExpected = differences.reduce((s, d) => s + d.expected, 0);
  const totalDeclared = differences.reduce((s, d) => s + d.declared, 0);
  const totalDiff = totalDeclared - totalExpected;

  return (
    <motion.div
      className="flex flex-col gap-pos-lg"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.h3 variants={rowItem} className="text-body-md font-semibold">
        {t('cash_shift.wizard_confirm_title')}
      </motion.h3>

      {requiresStepUp && (
        <motion.div
          variants={rowItem}
          className="rounded-pos p-pos-md text-body-sm"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
            color: 'var(--color-warning)',
          }}
        >
          {t('cash_shift.wizard_step_up_notice')}
        </motion.div>
      )}

      {/* Differences table */}
      <motion.table
        variants={rowItem}
        className="w-full text-left text-body-sm"
      >
        <thead>
          <tr style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)' }}>
            <th className="py-pos-xs pr-pos-md font-medium text-caption" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.wizard_method')}
            </th>
            <th className="py-pos-xs pr-pos-md font-medium text-caption text-right" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.wizard_expected')}
            </th>
            <th className="py-pos-xs pr-pos-md font-medium text-caption text-right" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.wizard_declared')}
            </th>
            <th className="py-pos-xs font-medium text-caption text-right" style={{ color: 'var(--color-ink-muted)' }}>
              {t('cash_shift.wizard_difference')}
            </th>
          </tr>
        </thead>
        <tbody>
          {differences.map((d) => (
            <motion.tr
              key={d.methodName}
              variants={rowItem}
              style={{
                borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 5%, transparent)',
              }}
            >
              <td className="py-pos-xs pr-pos-md font-data">
                {d.methodName}
                {d.isCash && (
                  <span className="ml-pos-xs text-caption" style={{ color: 'var(--color-ink-muted)' }}>
                    ({t('cash_shift.cash')})
                  </span>
                )}
              </td>
              <td className="py-pos-xs pr-pos-md font-data tabular-nums text-right">
                {formatCurrency(d.expected * 100)}
              </td>
              <td className="py-pos-xs pr-pos-md font-data tabular-nums text-right">
                {formatCurrency(d.declared * 100)}
              </td>
              <td className={`py-pos-xs font-data tabular-nums text-right ${
                d.diff === 0 ? '' : d.diff > 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {d.diff >= 0 ? '+' : ''}{formatCurrency(d.diff * 100)}
              </td>
            </motion.tr>
          ))}
          {/* Total row */}
          <motion.tr
            variants={rowItem}
            style={{ borderTop: '2px solid color-mix(in srgb, var(--color-ink) 15%, transparent)' }}
          >
            <td className="py-pos-xs pr-pos-md font-semibold text-body">
              {t('cash_shift.wizard_total')}
            </td>
            <td className="py-pos-xs pr-pos-md font-data tabular-nums text-right text-body">
              {formatCurrency(totalExpected * 100)}
            </td>
            <td className="py-pos-xs pr-pos-md font-data tabular-nums text-right text-body">
              {formatCurrency(totalDeclared * 100)}
            </td>
            <td className={`py-pos-xs font-data tabular-nums text-right text-body ${
              totalDiff === 0 ? '' : totalDiff > 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {totalDiff >= 0 ? '+' : ''}{formatCurrency(totalDiff * 100)}
            </td>
          </motion.tr>
        </tbody>
      </motion.table>

      {actionError && (
        <motion.p
          variants={rowItem}
          className="text-body-sm"
          style={{ color: 'var(--color-urgency)' }}
          role="alert"
        >
          {actionError}
        </motion.p>
      )}

      <motion.div
        variants={rowItem}
        className="flex justify-between border-t pt-pos-lg"
        style={{
          borderColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
        }}
      >
        <button type="button" onClick={onCancel} className="pos-button pos-button-ghost">
          {t('common.cancel')}
        </button>
        <button type="button" onClick={onConfirm} className="pos-button pos-button-danger">
          {t('cash_shift.wizard_confirm_close')}
        </button>
      </motion.div>
    </motion.div>
  );
};
