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
    good: 'text-green-600',
    warning: 'text-yellow-600',
    error: 'text-red-600',
  };

  const statusBgColors: Record<HealthStatus, string> = {
    good: 'bg-green-50 border-green-200',
    warning: 'bg-yellow-50 border-yellow-200',
    error: 'bg-red-50 border-red-200',
  };

  if (loading) {
    return (
      <div className="rounded-lg border p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
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
            <div className="font-bold text-green-600">{printerSummary.online}</div>
            <div className="text-gray-500">{t('printing.printHealth.online', 'En línea')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.offline > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
              {printerSummary.offline}
            </div>
            <div className="text-gray-500">{t('printing.printHealth.offline', 'Offline')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.noPaper > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
              {printerSummary.noPaper}
            </div>
            <div className="text-gray-500">{t('printing.printHealth.noPaper', 'Sin papel')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.error > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {printerSummary.error}
            </div>
            <div className="text-gray-500">{t('printing.printHealth.error', 'Error')}</div>
          </div>
          <div>
            <div className={`font-bold ${printerSummary.unknown > 0 ? 'text-gray-500' : 'text-gray-400'}`}>
              {printerSummary.unknown}
            </div>
            <div className="text-gray-500">{t('printing.printHealth.unknown', 'Desconocido')}</div>
          </div>
        </div>
      )}

      {queueSummary && (
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
          <span className="text-gray-500">
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
                className="text-blue-600 hover:text-blue-800"
                onClick={onViewQueue}
              >
                {t('printing.printHealth.viewQueue', 'Ver cola')}
              </button>
            )}
            {onConfigurePrinters && (
              <button
                type="button"
                className="text-blue-600 hover:text-blue-800"
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
