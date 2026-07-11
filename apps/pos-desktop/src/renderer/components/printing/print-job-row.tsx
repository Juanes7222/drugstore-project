/**
 * PrintJobRow — expanded row for a print job in the queue list.
 *
 * Shows status badge (colour-coded), job type label, attempt counter,
 * created/completed timestamps, error message, expandable routing log,
 * and retry/discard action buttons.
 */

import {
  type FC,
  useState,
  useCallback,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PrintJobRecord, PrintJobStatus } from '../../../domain/printing';

// ---------------------------------------------------------------------------
// Status badge definitions
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<
  PrintJobStatus,
  { label: string; dot: string; bg: string; text: string }
> = {
  PENDING: {
    label: 'Pendiente',
    dot: 'bg-yellow-500',
    bg: 'bg-yellow-50',
    text: 'text-yellow-800',
  },
  PRINTING: {
    label: 'Imprimiendo',
    dot: 'bg-blue-500',
    bg: 'bg-blue-50',
    text: 'text-blue-800',
  },
  COMPLETED: {
    label: 'Completado',
    dot: 'bg-green-500',
    bg: 'bg-green-50',
    text: 'text-green-800',
  },
  FAILED: {
    label: 'Fallido',
    dot: 'bg-red-500',
    bg: 'bg-red-50',
    text: 'text-red-800',
  },
  DISCARDED: {
    label: 'Descartado',
    dot: 'bg-gray-400',
    bg: 'bg-gray-100',
    text: 'text-gray-600',
  },
  RETRYING: {
    label: 'Reintentando',
    dot: 'bg-orange-500',
    bg: 'bg-orange-50',
    text: 'text-orange-800',
  },
};

// ---------------------------------------------------------------------------
// Job-type labels
// ---------------------------------------------------------------------------

const JOB_TYPE_LABELS: Record<string, string> = {
  SALE_RECEIPT: 'Recibo de venta',
  ELECTRONIC_INVOICE: 'Factura electrónica',
  CREDIT_NOTE: 'Nota crédito',
  CONTINGENCY_RECEIPT: 'Recibo contingencia',
  INVENTORY_REPORT: 'Reporte inventario',
  SHIFT_CLOSE_REPORT: 'Cierre de turno',
  TEST_PAGE: 'Prueba',
  OTHER: 'Otro',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PrintJobRowProps {
  job: PrintJobRecord;
  /** Async callback to retry a job. */
  onRetry: (jobId: string) => Promise<void>;
  /** Async callback to discard a job. */
  onDiscard: (jobId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PrintJobRow: FC<PrintJobRowProps> = ({
  job,
  onRetry,
  onDiscard,
}) => {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);

  const badge =
    STATUS_BADGE[job.status] ?? {
      label: job.status,
      dot: 'bg-gray-300',
      bg: 'bg-gray-100',
      text: 'text-gray-700',
    };
  const jobTypeLabel =
    JOB_TYPE_LABELS[job.jobType] ?? job.jobType;

  const canRetry =
    job.status === 'FAILED' || job.status === 'RETRYING';
  const canDiscard =
    job.status === 'PENDING' ||
    job.status === 'FAILED' ||
    job.status === 'RETRYING';

  const handleRetry = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      setRetrying(true);
      try {
        await onRetry(job.id);
      } finally {
        setRetrying(false);
      }
    },
    [onRetry, job.id],
  );

  const handleDiscard = useCallback(async () => {
    setDiscarding(true);
    try {
      await onDiscard(job.id);
    } finally {
      setDiscarding(false);
      setDialogOpen(false);
    }
  }, [onDiscard, job.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={`pos-panel border-l-4 p-3 ${
        job.status === 'FAILED'
          ? 'border-l-red-400'
          : job.status === 'DISCARDED'
            ? 'border-l-gray-300'
            : job.status === 'COMPLETED'
              ? 'border-l-green-400'
              : 'border-l-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Status dot + info */}
        <div className="min-w-0 flex-1">
          {/* Top row: badge + type */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status badge */}
            <span
              className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-caption font-medium ${badge.bg} ${badge.text}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${badge.dot}`}
                aria-hidden="true"
              />
              {badge.label}
            </span>

            {/* Job type label */}
            <span className="text-body-sm font-medium text-ink">
              {t(
                `printing.job_type.${job.jobType}`,
                jobTypeLabel,
              )}
            </span>

            {/* Attempt counter */}
            <span className="text-caption text-gray-400">
              {t('printing.queue.row.attempts', 'Intento {{n}}', {
                n: job.attempts,
              })}
            </span>
          </div>

          {/* Timestamps */}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-caption text-gray-400">
            <span>
              {t('printing.queue.row.created', 'Creado: {{date}}', {
                date: formatDateTime(job.createdAt),
              })}
            </span>
            {job.completedAt && (
              <span>
                {t(
                  'printing.queue.row.completed',
                  'Completado: {{date}}',
                  { date: formatDateTime(job.completedAt) },
                )}
              </span>
            )}
          </div>

          {/* Last error */}
          <AnimatePresence>
            {job.lastError && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-1.5 truncate text-caption text-red-500"
                title={job.lastError}
              >
                {job.lastError}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Expandable routing log */}
          {job.routingLog && (
            <div className="mt-2">
              <button
                type="button"
                className="flex items-center gap-1 text-caption text-gray-400 hover:text-gray-600"
                onClick={() => setLogExpanded((p) => !p)}
                aria-expanded={logExpanded}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${
                    logExpanded ? 'rotate-90' : ''
                  }`}
                  aria-hidden="true"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                {t(
                  'printing.queue.row.routing_log',
                  'Bitácora de enrutamiento',
                )}
              </button>
              <AnimatePresence>
                {logExpanded && (
                  <motion.pre
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-data text-caption text-gray-500"
                  >
                    {job.routingLog}
                  </motion.pre>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-col gap-1.5">
          {/* Retry button */}
          {canRetry && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              disabled={retrying}
              className="pos-button border-blue-200 bg-blue-50 text-caption text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              onClick={handleRetry}
              aria-label={t(
                'printing.queue.row.retry_aria',
                'Reintentar impresión',
              )}
            >
              {retrying
                ? t('printing.queue.row.retrying', '...')
                : t('printing.queue.row.retry', 'Reintentar')}
            </motion.button>
          )}

          {/* Discard button */}
          {canDiscard && (
            <Dialog.Root
              open={dialogOpen}
              onOpenChange={setDialogOpen}
            >
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="pos-button border-red-200 bg-red-50 text-caption text-red-600 hover:bg-red-100"
                  aria-label={t(
                    'printing.queue.row.discard_aria',
                    'Descartar trabajo',
                  )}
                >
                  {t('printing.queue.row.discard', 'Descartar')}
                </button>
              </Dialog.Trigger>

              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out" />
                <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded bg-white p-6 shadow-pos-elevated data-[state=open]:animate-in data-[state=closed]:animate-out">
                  <Dialog.Title className="text-ui font-semibold text-ink">
                    {t(
                      'printing.queue.row.discard_dialog.title',
                      'Descartar trabajo de impresión',
                    )}
                  </Dialog.Title>
                  <Dialog.Description className="mt-2 text-body-sm text-gray-500">
                    {t(
                      'printing.queue.row.discard_dialog.description',
                      '¿Está seguro de descartar este trabajo? No se imprimirá y se marcará como descartado.',
                    )}
                  </Dialog.Description>

                  <div className="mt-4 flex justify-end gap-2">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="pos-button pos-button-secondary text-body-sm"
                      >
                        {t('common.cancel', 'Cancelar')}
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      disabled={discarding}
                      className="pos-button bg-red-600 text-body-sm text-white hover:bg-red-700 disabled:opacity-50"
                      onClick={handleDiscard}
                    >
                      {discarding
                        ? t(
                            'printing.queue.row.discarding',
                            'Descartando...',
                          )
                        : t(
                            'printing.queue.row.confirm_discard',
                            'Descartar',
                          )}
                    </button>
                  </div>

                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                      aria-label={t('common.close', 'Cerrar')}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )}
        </div>
      </div>
    </motion.div>
  );
};
