/**
 * useDataExport — React hook that wires an export definition to the
 * DataExportService.
 *
 * Loads the full dataset through the definition's loader (honoring the
 * screen's current filters), builds the export document with the active
 * i18n translator and session user, and hands it to the export pipeline.
 *
 * Usage:
 * ```ts
 * const { exportTo, isExporting } = useDataExport(SALES_HISTORY_EXPORT, {
 *   since, until, query,
 * });
 * // <ExportMenu onExport={exportTo} exporting={isExporting} />
 * ```
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportFormat } from '../../common/export';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import type {
  ExportDefinition,
  ExportDocument,
} from '../../domain/export';
import {
  useDataExportService,
  useServiceContext,
} from '../components/common/service-context';

export function useDataExport<TArgs>(
  definition: ExportDefinition<TArgs>,
  args: TArgs,
): {
  exportTo: (format: ExportFormat) => Promise<void>;
  isExporting: boolean;
  error: string | null;
} {
  const { t, i18n } = useTranslation();
  const dataExportService = useDataExportService();
  const services = useServiceContext();
  const displayName = useLocalSessionStore((s) => s.session?.displayName);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportTo = useCallback(
    async (format: ExportFormat) => {
      setIsExporting(true);
      setError(null);
      try {
        const rows = await definition.load(services, args);

        const document: ExportDocument = {
          titleKey: definition.titleKey,
          titleFallback: definition.titleFallback,
          columns: definition.columns,
          rows,
          t,
          locale: i18n.language === 'en' ? 'en-US' : 'es-CO',
          userDisplayName: displayName ?? undefined,
          metadata: definition.metadata?.(args, t),
        };

        await dataExportService.exportAndDownload({
          format,
          document,
          filenamePrefix: definition.key,
        });
      } catch (err) {
        console.error(`[useDataExport] ${definition.key} export failed:`, err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsExporting(false);
      }
    },
    [definition, args, services, dataExportService, t, i18n.language, displayName],
  );

  return { exportTo, isExporting, error };
}