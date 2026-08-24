import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import {
  AttachMoneyIcon,
  ReceiptIcon,
  CancelIcon,
  PaymentsIcon,
  FactCheckIcon,
  EventBusyIcon,
  ExpiredLotIcon,
  VerifiedIcon,
  PendingActionsIcon,
  WarningAmberIcon,
  ArchiveIcon,
  SyncProblemIcon,
  HowToRegIcon,
  DevicesIcon,
} from "../components/icons/app-icons";
import { fetchDashboard } from "../services/backoffice";
import type { DashboardPeriod } from "../types/backoffice";
import { formatCop, formatNumber, formatDateTime } from "../utils/format";
import { KpiCard, type KpiTone, type KpiIconComponent, type KpiDelta } from "../components/common/kpi-card";
import { AlertBanner } from "../components/common/alert-banner";
import { PageHeader } from "../components/common/page-header";
import { SectionLabel } from "../components/common/section-label";
import { SalesTrendChart } from "../components/charts/sales-trend-chart";
import { LoadingState, ErrorState } from "../components/common/states";

interface KpiEntry {
  title: string;
  value: string;
  subtitle?: string;
  icon: KpiIconComponent;
  tone?: KpiTone;
  live?: boolean;
  delta?: KpiDelta;
}

const PERIOD_OPTIONS: DashboardPeriod[] = ["today", "7d", "30d"];

/** Signed percent change; null when the previous window had no activity. */
function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriod>("today");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard", selectedPeriod],
    queryFn: () => fetchDashboard(selectedPeriod),
    placeholderData: (previous) => previous,
  });

  const handlePeriod = (
    _: unknown,
    value: DashboardPeriod | null,
  ) => {
    if (value !== null) setSelectedPeriod(value);
  };

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const { sales, cashShifts, inventory, fiscal, sync, users, period, salesTrend } =
    data;

  const salesDelta = (current: string, previous: string): KpiDelta | undefined => {
    const pct = percentDelta(Number(current), Number(previous));
    if (pct === null || !Number.isFinite(pct)) return undefined;
    const rounded = Math.round(pct);
    return {
      label: `${rounded > 0 ? "+" : ""}${rounded}%`,
      detail: t("dashboard.deltaDetail", { value: rounded }),
      direction: pct >= 0 ? "up" : "down",
      positive: pct >= 0,
    };
  };

  const salesTodayDelta = salesDelta(sales.confirmedTotal, sales.previousTotal);
  const ticketDelta =
    sales.previousAverageTicket !== null
      ? salesDelta(sales.averageTicket, sales.previousAverageTicket)
      : undefined;

  const tone = (active: boolean): KpiTone => (active ? "warning" : "default");
  const dangerTone = (active: boolean): KpiTone =>
    active ? "error" : "default";

  // Grouped by operational domain: the dashboard reads like a receipt of
  // the business, one section per area the owner needs to check.
  const groups: { label: string; items: KpiEntry[] }[] = [
    {
      label: t("dashboard.groups.sales"),
      items: [
        {
          title: t("dashboard.salesToday"),
          value: formatCop(sales.confirmedTotal),
          subtitle: t("dashboard.salesTodaySub", {
            count: sales.confirmedCount,
          }),
          icon: AttachMoneyIcon,
          tone: "ok",
          delta: salesTodayDelta,
        },
        {
          title: t("dashboard.averageTicket"),
          value: formatCop(sales.averageTicket),
          subtitle: t("dashboard.averageTicketSub"),
          icon: ReceiptIcon,
          delta: ticketDelta,
        },
        {
          title: t("dashboard.annulledToday"),
          value: formatCop(sales.annulledTotal),
          subtitle: t("dashboard.annulledTodaySub", {
            count: sales.annulledCount,
          }),
          icon: CancelIcon,
          tone: tone(sales.annulledCount > 0),
        },
      ],
    },
    {
      label: t("dashboard.groups.cash"),
      items: [
        {
          title: t("dashboard.openShifts"),
          value: formatNumber(cashShifts.openCount),
          subtitle: t("dashboard.openShiftsSub"),
          icon: PaymentsIcon,
          tone: "info",
          live: cashShifts.openCount > 0,
        },
        {
          title: t("dashboard.cashDifferences30d"),
          value: formatCop(cashShifts.differenceAmount30d),
          subtitle: t("dashboard.cashDifferences30dSub", {
            count: cashShifts.differenceCount30d,
          }),
          icon: PaymentsIcon,
          tone: tone(cashShifts.differenceCount30d > 0),
        },
      ],
    },
    {
      label: t("dashboard.groups.inventory"),
      items: [
        {
          title: t("dashboard.pendingAdjustments"),
          value: formatNumber(inventory.pendingAdjustments),
          subtitle: t("dashboard.pendingAdjustmentsSub"),
          icon: FactCheckIcon,
          tone: tone(inventory.pendingAdjustments > 0),
        },
        {
          title: t("dashboard.expiringLots"),
          value: formatNumber(inventory.expiringLots),
          subtitle: t("dashboard.expiringLotsSub"),
          icon: EventBusyIcon,
          tone: tone(inventory.expiringLots > 0),
        },
        {
          title: t("dashboard.expiredLots"),
          value: formatNumber(inventory.expiredLots),
          subtitle: t("dashboard.expiredLotsSub"),
          icon: ExpiredLotIcon,
          tone: dangerTone(inventory.expiredLots > 0),
        },
      ],
    },
    {
      label: t("dashboard.groups.fiscal"),
      items: [
        {
          title: t("dashboard.fiscalValidated"),
          value: formatNumber(fiscal.validated),
          icon: VerifiedIcon,
          tone: "ok",
        },
        {
          title: t("dashboard.fiscalPending"),
          value: formatNumber(fiscal.pending),
          icon: PendingActionsIcon,
          tone: tone(fiscal.pending > 0),
        },
        {
          title: t("dashboard.fiscalRejected"),
          value: formatNumber(fiscal.rejected),
          icon: WarningAmberIcon,
          tone: dangerTone(fiscal.rejected > 0),
        },
        {
          title: t("dashboard.fiscalErrors"),
          value: formatNumber(fiscal.errors),
          icon: WarningAmberIcon,
          tone: dangerTone(fiscal.errors > 0),
        },
        {
          title: t("dashboard.fiscalContingency"),
          value: formatNumber(fiscal.contingency),
          icon: ArchiveIcon,
          tone: "info",
        },
      ],
    },
    {
      label: t("dashboard.groups.operations"),
      items: [
        {
          title: t("dashboard.syncFailures"),
          value: formatNumber(sync.permanentFailures),
          subtitle: t("dashboard.syncFailuresSub"),
          icon: SyncProblemIcon,
          tone: dangerTone(sync.permanentFailures > 0),
        },
        {
          title: t("dashboard.pendingApprovals"),
          value: formatNumber(users.pendingApproval),
          subtitle: t("dashboard.pendingApprovalsSub"),
          icon: HowToRegIcon,
          tone: tone(users.pendingApproval > 0),
        },
        {
          title: t("dashboard.activeSessions"),
          value: formatNumber(users.activeSessions),
          subtitle: t("dashboard.activeSessionsSub"),
          icon: DevicesIcon,
          tone: "info",
        },
      ],
    },
  ];

  const alerts: {
    severity: "error" | "warning";
    title: string;
    message: string;
    to?: string;
  }[] = [];

  if (inventory.pendingAdjustments > 0) {
    alerts.push({
      severity: "warning",
      title: t("dashboard.pendingAdjustments"),
      message: t("dashboard.alertPendingAdjustments", {
        count: inventory.pendingAdjustments,
      }),
      to: "/inventory-alerts",
    });
  }
  if (inventory.expiredLots > 0) {
    alerts.push({
      severity: "error",
      title: t("dashboard.expiredLots"),
      message: t("dashboard.alertExpiredLots", {
        count: inventory.expiredLots,
      }),
      to: "/inventory-alerts",
    });
  }
  if (fiscal.rejected > 0) {
    alerts.push({
      severity: "error",
      title: t("dashboard.fiscalRejected"),
      message: t("dashboard.alertFiscalRejected", { count: fiscal.rejected }),
      to: "/fiscal",
    });
  }
  if (fiscal.errors > 0) {
    alerts.push({
      severity: "error",
      title: t("dashboard.fiscalErrors"),
      message: t("dashboard.alertFiscalErrors", { count: fiscal.errors }),
      to: "/fiscal",
    });
  }
  if (sync.permanentFailures > 0) {
    alerts.push({
      severity: "error",
      title: t("dashboard.syncFailures"),
      message: t("dashboard.alertSyncFailures", {
        count: sync.permanentFailures,
      }),
    });
  }
  if (users.pendingApproval > 0) {
    alerts.push({
      severity: "warning",
      title: t("dashboard.pendingApprovals"),
      message: t("dashboard.alertPendingApprovals", {
        count: users.pendingApproval,
      }),
      to: "/users",
    });
  }
  if (cashShifts.differenceCount30d > 0) {
    alerts.push({
      severity: "warning",
      title: t("dashboard.cashDifferences30d"),
      message: t("dashboard.alertCashDifferences", {
        count: cashShifts.differenceCount30d,
      }),
      to: "/cash-shifts",
    });
  }

  let kpiIndex = 0;

  return (
    <Box>
      <PageHeader
        title={t("nav.dashboard")}
        subtitle={`${t("dashboard.period")}: ${formatDateTime(period.from)} — ${formatDateTime(period.to)}`}
        actions={
          <ToggleButtonGroup
            size="small"
            exclusive
            value={selectedPeriod}
            onChange={handlePeriod}
            aria-label={t("dashboard.period")}
          >
            {PERIOD_OPTIONS.map((option) => (
              <ToggleButton key={option} value={option}>
                {t(`dashboard.period_${option}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        }
      />

      <SalesTrendChart days={salesTrend.days} />

      <Box mb={3}>
        {groups.map((group) => (
          <Box key={group.label} mb={2}>
            <SectionLabel>{group.label}</SectionLabel>
            <Grid container spacing={2}>
              {group.items.map((item) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={item.title}>
                  <KpiCard
                    title={item.title}
                    value={item.value}
                    subtitle={item.subtitle}
                    icon={item.icon}
                    tone={item.tone}
                    live={item.live}
                    index={kpiIndex++}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>
        ))}
      </Box>

      {alerts.length > 0 ? (
        <Box role="region" aria-label={t("dashboard.alerts")} mb={3}>
          <Typography variant="h6" component="h2" mb={1}>
            {t("dashboard.alerts")}
          </Typography>
          <Grid container spacing={2}>
            {alerts.map((alert, index) => (
              <Grid item xs={12} md={6} key={`alert-${index}`}>
                <AlertBanner
                  severity={alert.severity}
                  title={alert.title}
                  message={alert.message}
                  to={alert.to}
                  actionLabel={alert.to ? t("dashboard.goTo") : undefined}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body1" color="success.main">
            {t("dashboard.noAlerts")}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
