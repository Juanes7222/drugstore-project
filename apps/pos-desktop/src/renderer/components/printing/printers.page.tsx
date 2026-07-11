/**
 * Printers page — manage configured printers, view status, test, edit, delete.
 *
 * Wiring container: fetches data from services and delegates rendering
 * to the PrinterCard presentational component.
 */

import { type FC, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usePrinterConfigService,
  usePrintQueueService,
  useConfigExportService,
} from '../common/service-context';
import type { PrinterConfigRecord, ImportReport } from '../../../domain/printing';
import { PrinterCard } from './index';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const PrintersPage: FC = () => {
  const { t } = useTranslation();
  const printerConfigService = usePrinterConfigService();
  const printQueueService = usePrintQueueService();
  const configExportService = useConfigExportService();

  const [printers, setPrinters] = useState<PrinterConfigRecord[]>([]);
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [importResult, setImportResult] = useState<ImportReport | null>(null);

  const loadData = useCallback(async () => {
    try {
      const list = await printerConfigService.listAll();
      setPrinters(list);

      // Load pending counts for each printer
      const counts: Record<string, number> = {};
      await Promise.all(
        list.map(async (p) => {
          try {
            counts[p.id] = await printQueueService.countPendingForPrinter(p.id);
          } catch {
            counts[p.id] = 0;
          }
        }),
      );
      setPendingCounts(counts);
    } catch {
      setPrinters([]);
    } finally {
      setLoading(false);
    }
  }, [printerConfigService, printQueueService]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = useCallback(
    async (id: string) => {
      await printerConfigService.delete(id);
      setPrinters((prev) => prev.filter((p) => p.id !== id));
    },
    [printerConfigService],
  );

  const handleTestPrint = useCallback(
    async (systemName: string) => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ success: boolean; errorMessage?: string }>('test_print', {
          printerSystemName: systemName,
          payloadType: 'HTML',
        });
        return result;
      } catch (err) {
        return {
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  const handleExport = useCallback(async () => {
    try {
      const json = await configExportService.exportConfig();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `printers-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [configExportService]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const report = await configExportService.importConfig(text, { overwrite: true });
        setImportResult(report);
        await loadData();
      } catch (err) {
        console.error('Import failed:', err);
      }
    },
    [configExportService, loadData],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <section aria-label={t('printing.printers.title', 'Impresoras')} className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-xl font-bold">
          {t('printing.printers.title', 'Impresoras configuradas')}
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            onClick={async () => {
              // Navigate to setup wizard
              window.location.hash = '#/printing/setup';
            }}
          >
            {t('printing.printers.addPrinter', 'Añadir impresora')}
          </button>
          <button
            type="button"
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={handleExport}
          >
            {t('printing.printers.export', 'Exportar')}
          </button>
        </div>
      </div>

      {/* Import bar */}
      <div className="border-b px-6 py-2">
        <label className="flex items-center gap-2 text-sm text-gray-500">
          {t('printing.printers.import', 'Importar configuración')}
          <input
            type="file"
            accept=".json"
            className="text-xs"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
          />
        </label>
        {importResult && (
          <div className="mt-1 text-xs">
            <span className="text-green-600">
              {importResult.matched} {t('printing.printers.matched', 'impresoras coincidieron')}
            </span>
            {importResult.unmatched.length > 0 && (
              <span className="ml-2 text-yellow-600">
                {importResult.unmatched.length} {t('printing.printers.unmatched', 'sin coincidencia')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Printer list */}
      <div className="flex-1 overflow-y-auto p-6">
        {printers.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            {t('printing.printers.noPrinters', 'No hay impresoras configuradas')}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {printers.map((printer) => (
              <PrinterCard
                key={printer.id}
                printer={printer}
                pendingCount={pendingCounts[printer.id] ?? 0}
                onTest={handleTestPrint}
                onDelete={handleDelete}
                onEdit={() => {
                  // Edit is not implemented yet — placeholder for future editor modal.
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
