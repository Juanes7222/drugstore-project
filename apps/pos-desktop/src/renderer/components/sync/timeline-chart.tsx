/**
 * SVG bar chart showing completed vs non-completed sync operations over the
 * last 24 hours.
 *
 * Renders a responsive inline SVG with green bars for completed operations
 * and red bars for non-completed operations, grouped by hour bucket.
 *
 * @category Component
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { HealthTimelineBucket } from "../../../domain/sync/sync-metrics.service";

interface TimelineChartProps {
  data: HealthTimelineBucket[];
}

const CHART_HEIGHT = 200;
const BAR_GAP = 2;
const MIN_BAR_WIDTH = 4;

export const TimelineChart: FC<TimelineChartProps> = ({ data }) => {
  const { t } = useTranslation();

  const maxValue = useMemo(
    () => Math.max(...data.map((b) => Math.max(b.completed, b.nonCompleted)), 1),
    [data],
  );

  const barWidth = useMemo(() => {
    // Aim for 80% of the available width to be bars (the rest is gaps)
    const totalGaps = (data.length - 1) * BAR_GAP;
    const available = Math.max(100 - totalGaps, data.length * MIN_BAR_WIDTH);
    return Math.floor(available / data.length);
  }, [data]);

  const chartWidth = useMemo(
    () => data.length * (barWidth + BAR_GAP) - BAR_GAP,
    [data, barWidth],
  );

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        {t("sync.timeline_title", "Sync Timeline (24h)")}
      </h3>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          {t("sync.timeline_empty", "No timeline data available")}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${Math.max(chartWidth, 100)} ${CHART_HEIGHT + 40}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t("sync.timeline_chart_aria", "Sync activity timeline chart")}
        >
          {/* Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = CHART_HEIGHT - fraction * CHART_HEIGHT + 20;
            return (
              <g key={fraction}>
                <text
                  x={-8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-gray-400 text-[10px]"
                >
                  {Math.round(maxValue * fraction)}
                </text>
                <line
                  x1={0}
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  className="stroke-gray-100"
                  strokeWidth={1}
                />
              </g>
            );
          })}

          {/* Bars */}
          {data.map((bucket, idx) => {
            const x = idx * (barWidth + BAR_GAP);
            const completedHeight = (bucket.completed / maxValue) * CHART_HEIGHT;
            const nonCompletedHeight =
              (bucket.nonCompleted / maxValue) * CHART_HEIGHT;
            const yBase = CHART_HEIGHT + 20;

            return (
              <g key={bucket.id}>
                {/* Completed bar (green, stacked below non-completed) */}
                <rect
                  x={x}
                  y={yBase - completedHeight - nonCompletedHeight}
                  width={barWidth}
                  height={completedHeight}
                  className="fill-green-400"
                  rx={1}
                />
                {/* Non-completed bar (red, on top) */}
                {bucket.nonCompleted > 0 && (
                  <rect
                    x={x}
                    y={yBase - nonCompletedHeight}
                    width={barWidth}
                    height={nonCompletedHeight}
                    className="fill-red-400"
                    rx={1}
                  />
                )}
                {/* X-axis label (every 4th bucket to avoid crowding) */}
                {idx % 4 === 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={yBase + 12}
                    textAnchor="middle"
                    className="fill-gray-400 text-[9px]"
                  >
                    {bucket.id.length >= 13
                      ? bucket.id.slice(11, 16)
                      : bucket.id.slice(0, 5)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Legend */}
          <g transform={`translate(0, ${CHART_HEIGHT + 30})`}>
            <rect x={0} y={0} width={10} height={10} className="fill-green-400" rx={1} />
            <text x={14} y={9} className="fill-gray-600 text-[10px]">
              {t("sync.timeline_completed", "Completed")}
            </text>
            <rect x={80} y={0} width={10} height={10} className="fill-red-400" rx={1} />
            <text x={94} y={9} className="fill-gray-600 text-[10px]">
              {t("sync.timeline_non_completed", "Failed")}
            </text>
          </g>
        </svg>
      )}
    </div>
  );
};
