/**
 * Local report detail table.
 *
 * Renders the paginated rows for the active report.  Uses native
 * `<table>` rather than TanStack Table — the schema is fully known
 * (the `ReportDefinition.columns`) and the row count fits on screen
 * with simple client-side pagination.  Heavyweight table primitives
 * would add weight without buying us anything.
 *
 * The chart-derived filter (set by clicking a chart data point) bolds
 * the matching rows in the first textual column.
 */

import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { AnyReportRow, ReportColumn, ReportColumnType, ReportDefinition } from "../../../domain/reports/report-types";
import type { ChartFilter } from "../../stores/reports.store";
import { useReportsLocale } from "./use-reports-locale";
import { StickyScrollX } from "../ui/sticky-scroll-x";

interface ReportTableProps {
  definition: ReportDefinition;
  rows: AnyReportRow[];
  total: number;
  chartFilter: ChartFilter | null;
}

const PAGE_SIZE = 25;

export const ReportTable: FC<ReportTableProps> = ({ definition, rows, total, chartFilter }) => {
  const { t } = useTranslation();
  const f = useReportsLocale();
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(() => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [rows, page]);
  const start = rows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min(rows.length, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-white p-3">
      <header className="flex items-center justify-between">
        <h3 className="text-body font-semibold">{t("reports.viewer.rows_total", { count: total })}</h3>
        <div className="flex items-center gap-2 text-caption text-muted">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border border-border bg-white px-2 py-0.5 disabled:opacity-50"
          >
            ‹
          </button>
          <span>
            {start}-{end} / {rows.length}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded border border-border bg-white px-2 py-0.5 disabled:opacity-50"
          >
            ›
          </button>
        </div>
      </header>
      <StickyScrollX>
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              {definition.columns.map((col) => (
                <th
                  key={col.id}
                  style={{ textAlign: col.align ?? 'left' }}
                  className="border-b border-border bg-surface px-2 py-1.5 text-caption font-semibold uppercase tracking-wide text-muted"
                >
                  {t(col.titleKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={definition.columns.length} className="px-2 py-3 text-center text-muted">
                  {t("reports.viewer.empty")}
                </td>
              </tr>
            ) : (
              pageRows.map((row, idx) => (
                <tr key={idx} className="border-b border-border/60">
                  {definition.columns.map((col) => (
                    <td
                      key={col.id}
                      style={{ textAlign: col.align ?? 'left' }}
                      className={
                        isHighlighted(col, row, chartFilter)
                          ? 'bg-amber-100 px-2 py-1.5 font-semibold text-ink'
                          : 'px-2 py-1.5 text-ink'
                      }
                    >
                      {renderCell(col, row, f, t)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </StickyScrollX>
    </div>
  );
};

const isHighlighted = (col: ReportColumn, row: AnyReportRow, filter: ChartFilter | null): boolean => {
  if (!filter || col.id !== filter.columnId) return false;
  const v = row[col.id];
  return String(v) === String(filter.value);
};

const renderCell = (
  col: ReportColumn,
  row: AnyReportRow,
  f: { currency: Intl.NumberFormat; integer: Intl.NumberFormat; numeric: Intl.NumberFormat; date: Intl.DateTimeFormat; dateTime: Intl.DateTimeFormat },
  t: TFunction,
): string => {
  const raw = row[col.id];
  if (raw === null || raw === undefined || raw === '') return '—';
  switch (col.type as ReportColumnType) {
    case 'currency':
      return f.currency.format(Number(raw));
    case 'percent':
      return `${Number(raw).toFixed(2)}%`;
    case 'integer':
      return f.integer.format(Number(raw));
    case 'number':
      return f.numeric.format(Number(raw));
    case 'date': {
      const d = new Date(raw as string);
      if (Number.isNaN(d.getTime())) return String(raw);
      return f.date.format(d);
    }
    case 'datetime': {
      const d = new Date(raw as string);
      if (Number.isNaN(d.getTime())) return String(raw);
      return f.dateTime.format(d);
    }
    case 'badge':
      // Enum cells (movement types, stock status, margin status) resolve
      // through a column i18n prefix; plain values fall back to raw text.
      if (col.badgeKeyPrefix) {
        const key = `${col.badgeKeyPrefix}.${String(raw)}`;
        const translated = t(key);
        return translated === key ? String(raw) : translated;
      }
      return String(raw);
    case 'text':
    default:
      return String(raw);
  }
};
