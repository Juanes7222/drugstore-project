import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import useTheme from "@mui/material/styles/useTheme";
import { fetchSaasRevenue } from "../../services/saas-admin";
import { formatCop, formatCopCompact, formatNumber } from "../../utils/format";
import type { KpiIconComponent } from "../../components/common/kpi-card";
import { KpiCard } from "../../components/common/kpi-card";
import { PageHeader } from "../../components/common/page-header";
import { LoadingState, ErrorState } from "../../components/common/states";
import {
  AttachMoneyIcon,
  PaymentsIcon,
  WorkspacePremiumIcon,
} from "../../components/icons/app-icons";

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("es-CO", {
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

interface TooltipPayloadItem {
  payload: { month: string; totalAmount: number; count: number };
}

/** Revenue view for the owner: collections per month, MRR, plan mix. */
export function RevenuePage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-revenue"],
    queryFn: fetchSaasRevenue,
  });

  const points = useMemo(
    () =>
      (data?.revenueByMonth ?? []).map((entry) => ({
        month: entry.month,
        totalAmount: Number(entry.totalAmount),
        count: entry.count,
      })),
    [data],
  );

  if (isLoading && !data) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <Box>
      <PageHeader
        title={t("saas.revenue.title")}
        subtitle={t("saas.revenue.subtitle")}
      />

      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title={t("saas.revenue.last30d")}
            value={formatCop(data.last30d.totalAmount)}
            subtitle={t("saas.kpi.sales30dSub", { count: formatNumber(data.last30d.count) })}
            icon={PaymentsIcon as KpiIconComponent}
          />
        </Grid>
        {/* MRR is null until active subscriptions carry recurring prices. */}
        {data.mrr !== null ? (
          <Grid item xs={12} sm={6} md={4}>
            <KpiCard
              title={t("saas.revenue.mrr")}
              value={formatCop(data.mrr)}
              icon={AttachMoneyIcon as KpiIconComponent}
              tone="ok"
            />
          </Grid>
        ) : null}
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title={t("saas.revenue.plansActive")}
            value={formatNumber(
              data.planDistribution.reduce(
                (sum, plan) => sum + plan.activeSubscriptions,
                0,
              ),
            )}
            icon={WorkspacePremiumIcon as KpiIconComponent}
          />
        </Grid>
      </Grid>

      <Card variant="outlined" component="figure" sx={{ m: 0, mb: 3, p: 2.5 }}>
        <Typography component="figcaption" style={SR_ONLY}>
          {t("saas.revenue.chartAria")}
        </Typography>
        <Typography variant="overline" color="text.secondary" component="p" m={0} mb={1.5}>
          {t("saas.revenue.byMonth")}
        </Typography>
        <Box aria-hidden sx={{ width: "100%", height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points}
              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis
                dataKey="month"
                tickFormatter={(month: string) =>
                  MONTH_LABEL_FORMATTER.format(new Date(`${month}-01T00:00:00`))
                }
                minTickGap={16}
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
                cursor={{ fill: theme.palette.action.hover }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  // Recharts v3 ships loose tooltip payload types; recover our point shape.
                  const point = (payload[0] as unknown as TooltipPayloadItem).payload;
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
                        {point.month}
                      </Typography>
                      <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatCop(point.totalAmount)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t("saas.revenue.payments", { count: point.count })}
                      </Typography>
                    </Box>
                  );
                }}
              />
              <Bar
                dataKey="totalAmount"
                fill={theme.palette.primary.main}
                radius={[4, 4, 0, 0]}
                maxBarSize={42}
              />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Card>

      <Typography variant="overline" component="h2" color="text.secondary">
        {t("saas.revenue.planMix")}
      </Typography>
      <Card variant="outlined">
        <CardContent sx={{ py: 1 }}>
          {data.planDistribution.length === 0 ? (
            <Typography variant="body2" color="text.secondary" py={2}>
              {t("common.empty")}
            </Typography>
          ) : (
            data.planDistribution.map((plan, index) => (
              <Box
                key={plan.planCode}
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                gap={2}
                py={1.25}
                {...(index > 0 ? { borderTop: 1, borderColor: "divider" } : {})}
              >
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {plan.planName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {plan.planCode}
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatNumber(plan.activeSubscriptions)}
                </Typography>
              </Box>
            ))
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
