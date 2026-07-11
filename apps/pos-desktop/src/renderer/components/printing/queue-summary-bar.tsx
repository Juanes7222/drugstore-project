/**
 * QueueSummaryBar — metrics row shown above the print queue list.
 *
 * Displays pending, printing, failed, discarded, and 24h-completed counts
 * in individual stat boxes with colour coding.
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import type { PrintQueueSummary } from '../../../domain/printing';

// ---------------------------------------------------------------------------
// Stat descriptor
// ---------------------------------------------------------------------------

interface StatDef {
  key: keyof PrintQueueSummary | 'averageAttempts';
  label: string;
  bgClass: string;
  textClass: string;
}

const STATS: StatDef[] = [
  {
    key: 'pending',
    label: 'Pendientes',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-800',
  },
  {
    key: 'printing',
    label: 'Imprimiendo',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-800',
  },
  {
    key: 'failed',
    label: 'Fallidos',
    bgClass: 'bg-red-50',
    textClass: 'text-red-800',
  },
  {
    key: 'discarded',
    label: 'Descartados',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-600',
  },
  {
    key: 'completed24h',
    label: 'Completados (24h)',
    bgClass: 'bg-green-50',
    textClass: 'text-green-800',
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface QueueSummaryBarProps {
  /** Aggregate queue metrics from the printing service. */
  summary: PrintQueueSummary;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const QueueSummaryBar: FC<QueueSummaryBarProps> = ({ summary }) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-wrap items-stretch gap-3 px-6 py-3"
      role="group"
      aria-label={t('printing.queue.summary.label', 'Resumen de la cola')}
    >
      {STATS.map((stat, i) => {
        const value = summary[stat.key as keyof PrintQueueSummary] ?? 0;

        return (
          <motion.div
            key={stat.key}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.2 }}
            className={`flex min-w-[100px] flex-col items-center justify-center rounded px-4 py-2 ${stat.bgClass}`}
          >
            <span className="font-data text-lg font-bold leading-none tabular-nums">
              {value}
            </span>
            <span className={`mt-1 text-xs font-medium ${stat.textClass}`}>
              {t(`printing.queue.summary.${stat.key}`, stat.label)}
            </span>
          </motion.div>
        );
      })}

      {/* Average attempts — secondary metric */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: STATS.length * 0.05, duration: 0.2 }}
        className="flex min-w-[120px] flex-col items-center justify-center rounded bg-surface px-4 py-2"
      >
        <span className="font-data text-lg font-bold leading-none tabular-nums">
          {summary.averageAttemptsBeforeSuccess.toFixed(1)}
        </span>
        <span className="mt-1 text-xs font-medium text-gray-500">
          {t(
            'printing.queue.summary.average_attempts',
            'Intentos promedio',
          )}
        </span>
      </motion.div>
    </div>
  );
};
