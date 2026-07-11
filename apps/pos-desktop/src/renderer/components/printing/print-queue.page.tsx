/**
 * Print queue page — view queued jobs, retry failed, discard stuck jobs.
 *
 * Wiring container: fetches data from services and delegates rendering
 * to PrintJobRow and QueueSummaryBar presentational components.
 */

import { type FC, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usePrintQueueService,
  usePrintingMetricsService,
} from '../common/service-context';
import type { PrintJobRecord, PrintQueueSummary, PrintJobStatus } from '../../../domain/printing';
import { PrintJobRow, QueueSummaryBar } from './index';

type QueueFilter = 'all' | 'pending' | 'failed' | 'completed' | 'discarded';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const PrintQueuePage: FC = () => {
  const { t } = useTranslation();
  const printQueueService = usePrintQueueService();
  const printingMetricsService = usePrintingMetricsService();

  const [jobs, setJobs] = useState<PrintJobRecord[]>([]);
  const [summary, setSummary] = useState<PrintQueueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [processingAll, setProcessingAll] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const statusFilter =
        filter === 'all'
          ? undefined
          : filter === 'pending'
            ? ['PENDING', 'PRINTING', 'RETRYING'] as PrintJobStatus[]
            : [filter.toUpperCase()] as PrintJobStatus[];

      const [jobsResult, summaryResult] = await Promise.all([
        printQueueService.listJobs({
          status: statusFilter,
          limit: 100,
        }),
        printingMetricsService.getPrintQueueSummary(),
      ]);

      setJobs(jobsResult.items);
      setSummary(summaryResult);
    } catch {
      setJobs([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [printQueueService, printingMetricsService, filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRetry = useCallback(
    async (jobId: string) => {
      await printQueueService.retryJob(jobId);
      await loadData();
    },
    [printQueueService, loadData],
  );

  const handleDiscard = useCallback(
    async (jobId: string) => {
      await printQueueService.discardJob(jobId, 'Descartado por el usuario');
      await loadData();
    },
    [printQueueService, loadData],
  );

  const handleProcessAll = useCallback(async () => {
    setProcessingAll(true);
    try {
      await printQueueService.processAllPending();
      await loadData();
    } finally {
      setProcessingAll(false);
    }
  }, [printQueueService, loadData]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await loadData();
  }, [loadData]);

  if (loading && jobs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <section aria-label={t('printing.queue.title', 'Cola de impresión')} className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-xl font-bold">{t('printing.queue.title', 'Cola de impresión')}</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            disabled={processingAll}
            onClick={handleProcessAll}
          >
            {processingAll
              ? t('printing.queue.processing', 'Procesando...')
              : t('printing.queue.retryAll', 'Reintentar todos')}
          </button>
          <button
            type="button"
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={handleRefresh}
          >
            {t('common.refresh', 'Actualizar')}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="border-b px-6 py-2">
        {summary && <QueueSummaryBar summary={summary} />}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 border-b px-6 py-2">
        {(['all', 'pending', 'failed', 'completed', 'discarded'] as QueueFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`rounded px-3 py-1 text-sm ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200'
            }`}
            onClick={() => setFilter(f)}
          >
            {f === 'all'
              ? t('printing.queue.filterAll', 'Todos')
              : t(`printing.queue.filter${f.charAt(0).toUpperCase() + f.slice(1)}`, f.charAt(0).toUpperCase() + f.slice(1))}
          </button>
        ))}
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto p-6">
        {jobs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            {t('printing.queue.empty', 'No hay trabajos en la cola')}
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <PrintJobRow
                key={job.id}
                job={job}
                onRetry={handleRetry}
                onDiscard={handleDiscard}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
