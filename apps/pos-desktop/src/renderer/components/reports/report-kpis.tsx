/**
 * KPI card grid.
 *
 * Renders one card per KPI in the response envelope.  The previous-period
 * delta (when present) is shown below the current value with a small
 * arrow indicator and the `vs. previous period` label.
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "@/components/ui/icons";
import type { ReportKpi } from "../../../domain/reports/report-types";
import { useReportsLocale } from "./use-reports-locale";

interface ReportKpisProps {
  kpis: ReportKpi[];
  fromCache: boolean;
}

const TONE_COLORS: Record<NonNullable<ReportKpi['tone']>, string> = {
  neutral: 'border-border bg-white',
  positive: 'border-emerald-300 bg-emerald-50',
  warning: 'border-amber-300 bg-amber-50',
  danger: 'border-rose-300 bg-rose-50',
  brand: 'border-pharma bg-pharma/5',
};

export const ReportKpis: FC<ReportKpisProps> = ({ kpis, fromCache }) => {
  if (!kpis.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.id} kpi={kpi} fromCache={fromCache} />
      ))}
    </div>
  );
};

const KpiCard: FC<{ kpi: ReportKpi; fromCache: boolean }> = ({ kpi, fromCache }) => {
  const { t } = useTranslation();
  const f = useReportsLocale();
  const tone = kpi.tone ?? 'neutral';
  const delta = useMemo(() => computeDelta(kpi.value, kpi.previousValue ?? null), [kpi.value, kpi.previousValue]);
  void fromCache;
  return (
    <article className={`flex flex-col gap-1 rounded-lg border p-3 shadow-sm ${TONE_COLORS[tone]}`}>
      <h3 className="text-caption uppercase tracking-wide text-muted">{t(kpi.titleKey)}</h3>
      <p className="text-h2 font-semibold text-ink">{formatKpiValue(kpi.value, kpi.unitKey, f)}</p>
      {delta ? (
        <p
          className={`flex items-center gap-1 text-caption ${
            delta.direction === 'up'
              ? 'text-emerald-700'
              : delta.direction === 'down'
                ? 'text-rose-700'
                : 'text-muted'
          }`}
        >
          {delta.direction === 'up' ? (
            <ArrowUpIcon className="h-3 w-3" />
          ) : delta.direction === 'down' ? (
            <ArrowDownIcon className="h-3 w-3" />
          ) : (
            <MinusIcon className="h-3 w-3" />
          )}
          <span>{delta.text}</span>
          <span className="text-muted">{t('reports.viewer.delta')}</span>
        </p>
      ) : null}
    </article>
  );
};

const formatKpiValue = (
  value: string | number | null,
  unitKey: string | undefined,
  f: { currency: Intl.NumberFormat; integer: Intl.NumberFormat; percent: Intl.NumberFormat },
): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (unitKey === 'reports.units.currency') {
      return f.currency.format(value);
    }
    if (unitKey === 'reports.units.percent') {
      return `${value.toFixed(1)}%`;
    }
    return f.integer.format(value);
  }
  if (typeof value === 'string' && unitKey === 'reports.units.currency') {
    const n = Number(value);
    if (!Number.isNaN(n)) {
      return f.currency.format(n);
    }
  }
  return String(value);
};

function computeDelta(
  current: string | number | null,
  previous: string | number | null,
): { direction: 'up' | 'down' | 'flat'; text: string } | null {
  if (previous === null || previous === undefined || previous === '' || current === null) return null;
  const c = Number(current);
  const p = Number(previous);
  if (Number.isNaN(c) || Number.isNaN(p)) return null;
  if (p === 0) return { direction: 'flat', text: '—' };
  const diff = c - p;
  const pct = (diff / Math.abs(p)) * 100;
  return {
    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
  };
}
