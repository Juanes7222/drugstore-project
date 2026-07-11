/**
 * PrinterCard — enhanced card for displaying a configured printer.
 *
 * Shows status dot, printer type/connection badges, job-type chips,
 * action buttons with hover and loading states, pending-job count,
 * and a delete confirmation dialog via Radix.
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
import type { PrinterConfigRecord } from '../../../domain/printing';
import { PrinterStatusBadge } from './printer-status-badge';

// ---------------------------------------------------------------------------
// Job-type labels for display
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
// Props
// ---------------------------------------------------------------------------

export interface PrinterCardProps {
  printer: PrinterConfigRecord;
  /** Number of pending print jobs for this printer. */
  pendingCount: number;
  /** Async test print callback. */
  onTest: (
    systemName: string,
  ) => Promise<{ success: boolean; errorMessage?: string }>;
  /** Delete printer callback. */
  onDelete: (id: string) => Promise<void>;
  /** Edit printer callback (opens the editor — not implemented here). */
  onEdit: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PrinterCard: FC<PrinterCardProps> = ({
  printer,
  pendingCount,
  onTest,
  onDelete,
  onEdit,
}) => {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleTest = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      setTesting(true);
      setTestResult(null);
      try {
        const result = await onTest(printer.systemName);
        setTestResult(result.success);
      } catch {
        setTestResult(false);
      } finally {
        setTesting(false);
      }
    },
    [onTest, printer.systemName],
  );

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await onDelete(printer.id);
    } finally {
      setDeleting(false);
      setDialogOpen(false);
    }
  }, [onDelete, printer.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="pos-panel flex flex-col p-4"
    >
      {/* Header: name + status */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body-sm font-semibold text-ink">
            {printer.friendlyName}
          </h3>
          <p className="truncate text-caption text-gray-400">
            {printer.systemName}
          </p>
        </div>
        <PrinterStatusBadge
          status={printer.status}
          className="ml-3 shrink-0"
        />
      </div>

      {/* Badges: type, connection, paper */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded bg-gray-100 px-2 py-0.5 text-caption font-medium text-gray-600">
          {printer.printerType}
        </span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-caption font-medium text-gray-600">
          {printer.connection}
        </span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-caption font-medium text-gray-600">
          {printer.paperSize}
        </span>
        {printer.supportsColor && (
          <span className="rounded bg-purple-50 px-2 py-0.5 text-caption font-medium text-purple-700">
            {t('printing.card.color', 'Color')}
          </span>
        )}
      </div>

      {/* Assigned job types */}
      <div className="mt-3 min-h-[1.25rem]">
        {printer.assignedJobs.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {printer.assignedJobs.map((job) => (
              <span
                key={job}
                className="inline-block max-w-[140px] truncate rounded bg-pharma/5 px-1.5 py-0.5 text-caption font-medium text-pharma/80"
                title={JOB_TYPE_LABELS[job] ?? job}
              >
                {t(
                  `printing.job_type.${job}`,
                  JOB_TYPE_LABELS[job] ?? job,
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-caption text-gray-400">
            {t(
              'printing.card.no_jobs',
              'Sin trabajos asignados',
            )}
          </p>
        )}
      </div>

      {/* Error message */}
      <AnimatePresence>
        {printer.lastErrorMessage && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 truncate text-caption text-red-500"
            title={printer.lastErrorMessage}
          >
            {printer.lastErrorMessage}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Pending count */}
      {pendingCount > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-caption text-urgency">
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
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span className="font-medium">
            {t('printing.card.pending_count', '{{count}} pendiente(s)', {
              count: pendingCount,
            })}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        {/* Test button */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={testing}
          className={`pos-button text-caption ${
            testResult === true
              ? 'border-green-200 bg-green-50 text-green-700'
              : testResult === false
                ? 'border-red-200 bg-red-50 text-red-600'
                : 'pos-button-secondary'
          }`}
          onClick={handleTest}
          aria-label={t('printing.card.test_aria', 'Probar impresora')}
        >
          {testing
            ? t('printing.card.testing', 'Probando...')
            : t('printing.card.test', 'Probar')}
        </motion.button>

        {/* Edit button */}
        <button
          type="button"
          className="pos-button pos-button-secondary text-caption"
          onClick={onEdit}
        >
          {t('printing.card.edit', 'Editar')}
        </button>

        {/* Delete button (opens confirmation dialog) */}
        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="pos-button border-red-200 bg-red-50 text-caption text-red-600 hover:bg-red-100"
              aria-label={t('printing.card.delete_aria', 'Eliminar impresora')}
            >
              {t('printing.card.delete', 'Eliminar')}
            </button>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out" />
            <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded bg-white p-6 shadow-pos-elevated data-[state=open]:animate-in data-[state=closed]:animate-out">
              <Dialog.Title className="text-ui font-semibold text-ink">
                {t(
                  'printing.card.delete_dialog.title',
                  'Eliminar impresora',
                )}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-body-sm text-gray-500">
                {t(
                  'printing.card.delete_dialog.description',
                  '¿Está seguro de eliminar "{{name}}"? Los trabajos de impresión pendientes se redirigirán a otra impresora o quedarán en la cola.',
                  { name: printer.friendlyName },
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
                  disabled={deleting}
                  className="pos-button bg-red-600 text-body-sm text-white hover:bg-red-700 disabled:opacity-50"
                  onClick={handleDelete}
                >
                  {deleting
                    ? t('printing.card.deleting', 'Eliminando...')
                    : t('printing.card.confirm_delete', 'Eliminar')}
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
      </div>

      {/* Test result feedback */}
      <AnimatePresence>
        {testResult !== null && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-2 text-caption font-medium ${
              testResult ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {testResult
              ? t('printing.card.test_success', '✓ Impresión exitosa')
              : t('printing.card.test_fail', '✗ Error al imprimir')}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
