/**
 * Print Health Tile — a compact status panel for the manager dashboard.
 *
 * Shows an at-a-glance view of print queue and printer status.
 * Intended to be embedded in the sync-health page or manager dashboard.
 *
 * This is a wiring container that calls PrintingMetricsService
 * and delegates rendering to a simple summary layout.
 */

import { type FC, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usePrintingMetricsService,
  usePrintQueueService,
} from '../common/service-context';
import type { PrintQueueSummary, PrinterStatusSummary } from '../../../domain/printing';

type HealthStatus = 'good' | 'warning' | 'error';

export const PrintHealthTile: FC<{
  onViewQueue?: () => void;
  onConfigurePrinters?: () => void;
}> = ({ onViewQueue, onConfigurePrinters }) => {
  const { t } = useTranslation();
  const printingMetricsService = usePrintingMetricsService();
  const printQueueService = usePrintQueueService();

  const [queueSummary, setQueueSummary] = useState<PrintQueueSummary | null>(null);
  const [printerSummary, setPrinterSummary] = useState<PrinterStatusSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [qs, ps] = await Promise.all([
        printingMetricsService.getPrintQueueSummary(),
        printingMetricsService.getPrinterStatusSummary(),
      ]);
      setQueueSummary(qs);
      setPrinterSummary(ps);
    } catch {
      setQueueSummary(null);
      setPrinterSummary(null);
    } finally {
      setLoading(false);
    }
  }, [printingMetricsService]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getOverallStatus = (): HealthStatus => {
    if (!queueSummary || !printerSummary) return 'warning';
    if (queueSummary.failed > 0 || printerSummary.error > 0) return 'error';
    if (queueSummary.pending > 0 || printerSummary.offline > 0 || printerSummary.noPaper > 0) return 'warning';
    return 'good';
  };

  const status = getOverallStatus();

  const statusColors: Record<HealthStatus, string> = {
    good: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
  };

  const statusBgColors: Record<HealthStatus, string> = {
    good: 'bg-success-container border-success/20',
    warning: 'bg-urgency-surface border-urgency/20',
    error: 'bg-error-container border-error/20',
  };

  if (loading) {
    return (
      <div className="rounded-lg border p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-variant" />
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-4 ${statusBgColors[status]}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t('printing.printHealth.title', 'Salud de impresión')}
        </h3>
        <span className={`text-xs font-medium ${statusColors[status]}`}>
          {status === 'good'
            ? t('printing.printHealth.good', 'Todo bien')
            : status === 'warning'
              ? t('printing.printHealth.warning', 'Atención')
              : t('printing.printHealth.error', 'Requiere acción')}
        </span>
      </div>

      {printerSummary && (
        <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
          <div>
            <div className="font-bold text-success">{printerSummary.online}</div>
            <div className="text-ink-muted">{t('printing.printHealth.online', 'En línea')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.offline > 0 ? 'text-warning' : 'text-ink-muted'}`}>
              {printerSummary.offline}
            </div>
            <div className="text-ink-muted">{t('printing.printHealth.offline', 'Offline')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.noPaper > 0 ? 'text-warning' : 'text-ink-muted'}`}>
              {printerSummary.noPaper}
            </div>
            <div className="text-ink-muted">{t('printing.printHealth.noPaper', 'Sin papel')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.error > 0 ? 'text-error' : 'text-ink-muted'}`}>
              {printerSummary.error}
            </div>
            <div className="text-ink-muted">{t('printing.printHealth.error', 'Error')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.unknown > 0 ? 'text-ink-muted' : 'text-ink-muted'}`}>
              {printerSummary.unknown}
            </div>
            <div className="text-ink-muted">{t('printing.printHealth.unknown', 'Desconocido')}</div>
          </div>
        </div>
      )}

      {queueSummary && (
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
          <span className="text-ink-muted">
            {queueSummary.pending > 0
              ? t('printing.printHealth.pendingJobs', '{count} trabajo(s) pendiente(s)', { count: queueSummary.pending })
              : t('printing.printHealth.noPending', 'Sin trabajos pendientes')}
            {queueSummary.failed > 0 &&
              ` · ${t('printing.printHealth.failedJobs', '{count} fallido(s)', { count: queueSummary.failed })}`}
          </span>
          <div className="flex gap-2">
            {onViewQueue && (
              <button
                type="button"
                className="text-pharma hover:text-pharma/80"
                onClick={onViewQueue}
              >
                {t('printing.printHealth.viewQueue', 'Ver cola')}
              </button>
            )}
            {onConfigurePrinters && (
              <button
                type="button"
                className="text-pharma hover:text-pharma/80"
                onClick={onConfigurePrinters}
              >
                {t('printing.printHealth.configure', 'Configurar')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
