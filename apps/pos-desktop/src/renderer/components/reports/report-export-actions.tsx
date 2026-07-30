/**
 * Report export action bar.
 *
 * Renders one button per supported export format.  On click, asks the
 * report export service to render the artifact and trigger a browser
 * download (or open the print dialog).  Records the export in the
 * local audit log on success.
 */

import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type ReactECharts from "echarts-for-react";
import { FileDown, FileSpreadsheet, FileText, Printer } from "lucide-react";
import type { Services } from "../common/service-context";
import type { ReportDefinition, ReportExportFormat, ReportResponse } from "../../../domain/reports/report-types";
import { createLocalAuditWriter } from "../../../domain/audit/local-audit-writer.service";
import { LocalAuditEvent } from "../../../domain/audit/local-audit-writer.service";
import { getLocalDatabase } from "../../../infrastructure/local-database";

interface ReportExportActionsProps {
  response: ReportResponse;
  definition: ReportDefinition;
  services: Services;
  userDisplayName: string;
  chartRef: React.MutableRefObject<ReactECharts | null>;
  isLoading: boolean;
}

export const ReportExportActions: FC<ReportExportActionsProps> = ({
  response,
  definition,
  services,
  userDisplayName,
  chartRef,
  isLoading,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<ReportExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(
    async (format: ReportExportFormat) => {
      setBusy(format);
      setError(null);
      try {
        let chartDataUrl: string | undefined;
        if (format === 'pdf' && chartRef.current) {
          const instance = chartRef.current.getEchartsInstance?.();
          if (instance) {
            try {
              chartDataUrl = instance.getDataURL({
                type: 'png',
                pixelRatio: 2,
                backgroundColor: '#FFFFFF',
              });
            } catch {
              chartDataUrl = undefined;
            }
          }
        }
        const savedPath = await services.reportExportService.exportAndDownload({
          response,
          definition,
          format,
          chartDataUrl,
          filenamePrefix: definition.code.toLowerCase().replace(/_/gu, '-'),
          userDisplayName,
        });
        // User cancelled the save dialog — nothing to do.
        if (!savedPath && format !== 'print') return;
        // Audit the export — fire and forget.
        try {
          const { prisma } = await getLocalDatabase();
          const audit = createLocalAuditWriter(prisma as never);
          await audit.write(LocalAuditEvent.REPORT_EXPORTED, {
            category: 'report',
            entityType: 'Report',
            entityId: definition.code,
            userId: userDisplayName,
            details: { filename: savedPath ?? format, format, filters: response.filters },
          });
        } catch {
          // Audit failures never break the export.
        }
        // Show a brief inline success via the error slot.
        setError(
          savedPath
            ? t("reports.exports.success", { filename: savedPath })
            : t("reports.exports.sent_to_print"),
        );
        setTimeout(() => setError(null), 2500);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("reports.exports.failure"),
        );
      } finally {
        setBusy(null);
      }
    },
    [chartRef, definition, response, services, t, userDisplayName],
  );

  void isLoading;

  const ICONS: Record<ReportExportFormat, React.ComponentType<{ className?: string }>> = {
    pdf: FileText,
    excel: FileSpreadsheet,
    csv: FileDown,
    print: Printer,
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption uppercase tracking-wide text-muted">
        {t("reports.exports.label")}:
      </span>
      {definition.exportFormats.map((format) => {
        const Icon = ICONS[format];
        return (
          <button
            key={format}
            type="button"
            onClick={() => void handle(format)}
            disabled={busy === format}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-body-sm text-ink hover:bg-amber-50 disabled:opacity-50"
          >
            <Icon className="h-4 w-4" />
            <span>{t(`reports.exports.${format}`)}</span>
          </button>
        );
      })}
      {busy ? (
        <span className="text-caption text-muted">{t("reports.exports.generating")}</span>
      ) : null}
      {error ? <span className="text-caption text-pharma">{error}</span> : null}
    </div>
  );
};
