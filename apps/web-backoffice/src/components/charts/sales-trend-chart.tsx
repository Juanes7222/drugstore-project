import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@mui/material/Card";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import useTheme from "@mui/material/styles/useTheme";
import { useTranslation } from "react-i18next";
import type { SalesTrendDay } from "../../types/backoffice";
import { formatCop, formatCopCompact, formatDate } from "../../utils/format";

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
});

// Screen-reader-only summary style (MUI's visuallyHidden equivalent).
const SR_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

interface TrendPoint {
  date: string;
  amount: number;
}

interface TooltipPayloadItem {
  payload: TrendPoint;
}

interface SalesTrendChartProps {
  days: SalesTrendDay[];
}

/**
 * Hero chart of the dashboard: confirmed sales per day for the last two
 * weeks. Data comes embedded in the dashboard response (no extra request).
 */
export function SalesTrendChart({ days }: SalesTrendChartProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const points = useMemo<TrendPoint[]>(
    () =>
      days.map((day) => ({
        date: day.date,
        amount: Number(day.confirmedAmount),
      })),
    [days],
  );

  const [totalAmount, totalCount] = useMemo(
    () => [
      points.reduce((sum, point) => sum + point.amount, 0),
      days.reduce((sum, day) => sum + day.confirmedCount, 0),
    ],
    [points, days],
  );

  const prefersReducedMotion = useMemo(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  if (days.length === 0) return null;

  return (
    <Card variant="outlined" className="animate-fade-up" component="figure" sx={{ m: 0, mb: 3, p: 2.5 }}>
      <Typography component="figcaption" style={SR_ONLY}>
        {t("dashboard.trendAria", {
          total: formatCop(totalAmount),
          count: totalCount,
        })}
      </Typography>
      <Box display="flex" flexWrap="wrap" alignItems="baseline" justifyContent="space-between" gap={1} mb={0.5}>
        <Typography variant="overline" color="text.secondary">
          {t("dashboard.trendTitleRange", { count: days.length })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatDate(days[0].date)} — {formatDate(days[days.length - 1].date)}
        </Typography>
      </Box>
      <Box
        component="p"
        m={0}
        mb={1}
        fontWeight={800}
        fontSize={28}
        lineHeight={1.2}
        letterSpacing="-0.02em"
        sx={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatCop(totalAmount)}
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" m={0} mb={2}>
        {t("dashboard.trendCountSub", { count: totalCount })}
      </Typography>

      {/* Decorative for assistive tech: the figcaption carries the summary. */}
      <Box aria-hidden sx={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="sales-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.28} />
                <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              stroke={theme.palette.divider}
            />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) =>
                DAY_LABEL_FORMATTER.format(new Date(`${date}T00:00:00`))
              }
              interval="preserveStartEnd"
              minTickGap={28}
              tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value: number) => formatCopCompact(value)}
              width={64}
              tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: theme.palette.divider, strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                // Recharts v3 ships loose tooltip payload types; recover our point shape.
                const point = (payload[0] as unknown as TooltipPayloadItem).payload;
                const day = days.find((entry) => entry.date === point.date);
                return (
                  <Box
                    sx={{
                      bgcolor: "background.paper",
                      border: `1px solid ${theme.palette.divider}`,
                      borderRadius: 1.5,
                      px: 1.5,
                      py: 1,
                      boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" display="block">
                      {formatDate(point.date)}
                    </Typography>
                    <Typography
                      variant="body2"
                      fontWeight={700}
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatCop(point.amount)}
                    </Typography>
                    {day ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t("dashboard.trendCountSub", { count: day.confirmedCount })}
                      </Typography>
                    ) : null}
                  </Box>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="amount"
              stroke={theme.palette.primary.main}
              strokeWidth={2}
              fill="url(#sales-trend-fill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={!prefersReducedMotion}
              animationDuration={400}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Card>
  );
}
