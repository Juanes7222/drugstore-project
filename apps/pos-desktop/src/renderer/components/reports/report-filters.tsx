/**
 * Local report filter panel.
 *
 * Renders the preset/date-range controls plus any report-specific
 * filters (cashier, category, top-N, etc.).  The shape of `value` is
 * the same as `ReportDefinition.defaultFilters` plus report-specific
 * keys — the viewer passes the whole object straight to the execution
 * service.
 */

import { type FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ReportDatePreset,
  type DateRangeFilter,
  type ReportDefinition,
} from "../../../domain/reports/report-types";
import { resolvePresetDates } from "../../../domain/reports/report-filter-schemas";
import { ShiftPicker, type ShiftOption } from "./shift-picker";

interface ReportFiltersProps {
  definition: ReportDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  onApply: () => void;
  /** Options for the CASH_SHIFT_CLOSE shift selector. */
  shiftOptions?: ShiftOption[];
  shiftsLoading?: boolean;
}

export const ReportFilters: FC<ReportFiltersProps> = ({
  definition,
  value,
  onChange,
  onApply,
  shiftOptions = [],
  shiftsLoading = false,
}) => {
  const { t } = useTranslation();
  const base = (value as DateRangeFilter) ?? (definition.defaultFilters as DateRangeFilter);
  const [preset, setPreset] = useState<ReportDatePreset>(base.preset ?? ReportDatePreset.THIS_MONTH);
  const [from, setFrom] = useState(base.dateFrom);
  const [to, setTo] = useState(base.dateTo);
  const [compare, setCompare] = useState<boolean>(base.comparePrevious ?? false);
  const [topN, setTopN] = useState<number>((value as { topN?: number })?.topN ?? 20);
  const [lowMargin, setLowMargin] = useState<number>(
    (value as { lowMarginPercent?: number })?.lowMarginPercent ?? 5,
  );
  const [daysAhead, setDaysAhead] = useState<number>((value as { daysAhead?: number })?.daysAhead ?? 60);
  const [daysWithout, setDaysWithout] = useState<number>(
    (value as { daysWithoutMovement?: number })?.daysWithoutMovement ?? 90,
  );
  const [shiftId, setShiftId] = useState<string>((value as { shiftId?: string })?.shiftId ?? '');

  const handlePresetChange = useCallback((next: ReportDatePreset) => {
    setPreset(next);
    if (next !== ReportDatePreset.CUSTOM) {
      const { dateFrom, dateTo } = resolvePresetDates(next);
      setFrom(dateFrom);
      setTo(dateTo);
    }
  }, []);

  const handleApply = useCallback(() => {
    let resolved = { dateFrom: from, dateTo: to };
    if (preset !== ReportDatePreset.CUSTOM) {
      resolved = resolvePresetDates(preset);
      setFrom(resolved.dateFrom);
      setTo(resolved.dateTo);
    }
    const next: Record<string, unknown> = {
      preset,
      dateFrom: resolved.dateFrom,
      dateTo: resolved.dateTo,
      comparePrevious: compare,
      ...(definition.code === 'SALES_BY_PRODUCT' ? { topN } : {}),
      ...(definition.code === 'PROFIT_MARGIN_BY_PRODUCT' ? { lowMarginPercent: lowMargin } : {}),
      ...(definition.code === 'INV_EXPIRING_LOTS' ? { daysAhead } : {}),
      ...(definition.code === 'INV_LOW_MOVEMENT' ? { daysWithoutMovement: daysWithout } : {}),
      ...(definition.code === 'CASH_SHIFT_CLOSE' ? { shiftId } : {}),
    };
    onChange(next);
    onApply();
  }, [
    preset,
    from,
    to,
    compare,
    topN,
    lowMargin,
    daysAhead,
    daysWithout,
    shiftId,
    definition.code,
    onChange,
    onApply,
  ]);

  const showDateRange = useMemo(
    () => definition.code !== 'CASH_SHIFT_CLOSE' && definition.code !== 'INV_CURRENT_STOCK',
    [definition.code],
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-3">
      {showDateRange ? (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted" htmlFor="preset">{t("reports.filters.preset_label")}</label>
            <select
              id="preset"
              value={preset}
              onChange={(e) => handlePresetChange(e.target.value as ReportDatePreset)}
              className="rounded-md border border-border bg-white px-2 py-1 text-body-sm"
            >
              <option value={ReportDatePreset.TODAY}>{t("reports.filters.preset_today")}</option>
              <option value={ReportDatePreset.YESTERDAY}>{t("reports.filters.preset_yesterday")}</option>
              <option value={ReportDatePreset.THIS_WEEK}>{t("reports.filters.preset_this_week")}</option>
              <option value={ReportDatePreset.THIS_MONTH}>{t("reports.filters.preset_this_month")}</option>
              <option value={ReportDatePreset.LAST_MONTH}>{t("reports.filters.preset_last_month")}</option>
              <option value={ReportDatePreset.CUSTOM}>{t("reports.filters.preset_custom")}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted" htmlFor="from">{t("reports.filters.date_from")}</label>
            <input
              id="from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset(ReportDatePreset.CUSTOM);
              }}
              className="rounded-md border border-border bg-white px-2 py-1 text-body-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted" htmlFor="to">{t("reports.filters.date_to")}</label>
            <input
              id="to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset(ReportDatePreset.CUSTOM);
              }}
              className="rounded-md border border-border bg-white px-2 py-1 text-body-sm"
            />
          </div>
          <label className="ml-2 flex items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            {t("reports.filters.compare_previous")}
          </label>
        </>
      ) : null}
      {definition.code === 'SALES_BY_PRODUCT' ? (
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted" htmlFor="topN">{t("reports.filters.top_n")}</label>
          <input
            id="topN"
            type="number"
            min={1}
            max={500}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="w-20 rounded-md border border-border bg-white px-2 py-1 text-body-sm"
          />
        </div>
      ) : null}
      {definition.code === 'PROFIT_MARGIN_BY_PRODUCT' ? (
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted" htmlFor="lowMargin">{t("reports.filters.low_margin_percent")}</label>
          <input
            id="lowMargin"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={lowMargin}
            onChange={(e) => setLowMargin(Number(e.target.value))}
            className="w-20 rounded-md border border-border bg-white px-2 py-1 text-body-sm"
          />
        </div>
      ) : null}
      {definition.code === 'INV_EXPIRING_LOTS' ? (
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted" htmlFor="daysAhead">{t("reports.filters.days_ahead")}</label>
          <input
            id="daysAhead"
            type="number"
            min={1}
            max={365}
            value={daysAhead}
            onChange={(e) => setDaysAhead(Number(e.target.value))}
            className="w-20 rounded-md border border-border bg-white px-2 py-1 text-body-sm"
          />
        </div>
      ) : null}
      {definition.code === 'INV_LOW_MOVEMENT' ? (
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted" htmlFor="daysWithout">{t("reports.filters.days_without_movement")}</label>
          <input
            id="daysWithout"
            type="number"
            min={1}
            max={730}
            value={daysWithout}
            onChange={(e) => setDaysWithout(Number(e.target.value))}
            className="w-20 rounded-md border border-border bg-white px-2 py-1 text-body-sm"
          />
        </div>
      ) : null}
      {definition.code === 'CASH_SHIFT_CLOSE' ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted">{t("reports.filters.shift_label")}</span>
          <ShiftPicker
            options={shiftOptions}
            value={shiftId}
            onChange={setShiftId}
            loading={shiftsLoading}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={handleApply}
        className="ml-auto rounded-md bg-pharma px-3 py-1.5 text-body-sm font-medium text-white hover:opacity-90"
      >
        {t("reports.viewer.execute")}
      </button>
    </div>
  );
};
