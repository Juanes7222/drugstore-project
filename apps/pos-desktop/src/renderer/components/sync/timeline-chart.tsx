/**
 * Bar chart showing completed vs non-completed sync operations over the
 * last 24 hours.  Uses Apache ECharts for responsive sizing, smooth
 * tooltips, and consistent theming with the POS design tokens.
 *
 * @category Component
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactECharts from "echarts-for-react";
import type { HealthTimelineBucket } from "../../../domain/sync/sync-metrics.service";

// ── Design tokens (hardcoded here so ECharts option objects stay plain) ─────
const PHARMA = "#0B6E6B";
const ERROR = "#D32F2F";
const INK = "#171614";
const INK_MUTED = "#8B8A87";
const BORDER = "#D4D2CC";
const PANEL = "#FFFFFF";

interface TimelineChartProps {
  data: HealthTimelineBucket[];
}

export const TimelineChart: FC<TimelineChartProps> = ({ data }) => {
  const { t } = useTranslation();

  const option = useMemo(() => {
    const labels = data.map((b) => {
      // Bucket.id is an ISO hour boundary like "2026-07-28T14:00:00.000Z"
      const hr = b.id.length >= 13 ? b.id.slice(11, 16) : b.id;
      return hr;
    });

    const completed = data.map((b) => b.completed);
    const failed = data.map((b) => b.nonCompleted);

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        backgroundColor: PANEL,
        borderColor: BORDER,
        borderWidth: 1,
        textStyle: { color: INK, fontSize: 12, fontFamily: "Inter" },
        formatter: (params: Array<{ seriesName: string; value: number; axisValueLabel: string }>) => {
          if (!params?.length) return "";
          const title = `<strong>${params[0].axisValueLabel}</strong>`;
          const rows = params
            .map((p) => `${p.seriesName}: ${p.value}`)
            .join("<br/>");
          return `${title}<br/>${rows}`;
        },
      },
      grid: {
        left: 40,
        right: 16,
        top: 12,
        bottom: 28,
        containLabel: false,
      },
      xAxis: {
        type: "category" as const,
        data: labels,
        axisLine: { lineStyle: { color: BORDER } },
        axisTick: { alignWithLabel: true },
        axisLabel: {
          color: INK_MUTED,
          fontSize: 10,
          fontFamily: "Inter",
          // Show every 4th label to avoid crowding
          interval: 3,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        minInterval: 1,
        axisLine: { show: false },
        axisLabel: {
          color: INK_MUTED,
          fontSize: 10,
          fontFamily: "Inter",
        },
        splitLine: {
          lineStyle: { color: BORDER, type: "dashed" as const },
        },
      },
      series: [
        {
          name: t("sync.timeline_completed"),
          type: "bar" as const,
          stack: "total",
          data: completed,
          itemStyle: { color: PHARMA, borderRadius: [0, 0, 0, 0] },
          barMaxWidth: 24,
          emphasis: { focus: "series" as const },
        },
        {
          name: t("sync.timeline_non_completed"),
          type: "bar" as const,
          stack: "total",
          data: failed,
          itemStyle: { color: ERROR, borderRadius: [0, 0, 0, 0] },
          barMaxWidth: 24,
          emphasis: { focus: "series" as const },
        },
      ],
      // ── Legend (top-right, compact) ──
      legend: {
        data: [
          { name: t("sync.timeline_completed"), icon: "roundRect" },
          { name: t("sync.timeline_non_completed"), icon: "roundRect" },
        ],
        right: 0,
        top: 0,
        textStyle: { color: INK_MUTED, fontSize: 11, fontFamily: "Inter" },
        itemWidth: 10,
        itemHeight: 8,
      },
      // ── Animation — instant for data updates, no gimmicks ──
      animationDuration: 300,
      animationEasing: "linear" as const,
    };
  }, [data, t]);

  return (
    <div className="mb-6 rounded-lg border border-border bg-panel p-4 shadow-pos-panel">
      <h3 className="mb-3 text-body-sm font-semibold text-ink">
        {t("sync.timeline_title")}
      </h3>

      {data.length === 0 ? (
        <p className="py-8 text-center text-body-sm text-ink-muted">
          {t("sync.timeline_empty")}
        </p>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 200, width: "100%" }}
          notMerge
          lazyUpdate
          opts={{ renderer: "svg" }}
          aria-label={t("sync.timeline_title")}
        />
      )}
    </div>
  );
};
