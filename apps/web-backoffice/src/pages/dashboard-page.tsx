import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PaymentsIcon from "@mui/icons-material/Payments";
import InventoryIcon from "@mui/icons-material/Inventory";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import VerifiedIcon from "@mui/icons-material/Verified";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import CancelIcon from "@mui/icons-material/Cancel";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SyncProblemIcon from "@mui/icons-material/SyncProblem";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import DevicesIcon from "@mui/icons-material/Devices";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import { fetchDashboard } from "../services/backoffice";
import { formatCop, formatNumber, formatDateTime } from "../utils/format";
import { KpiCard, type KpiTone } from "../components/common/kpi-card";
import { AlertBanner } from "../components/common/alert-banner";
import { PageHeader } from "../components/common/page-header";
import { LoadingState, ErrorState } from "../components/common/states";

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const { sales, cashShifts, inventory, fiscal, sync, users, period } = data;

  const tone = (active: boolean): KpiTone => (active ? "warning" : "default");
  const dangerTone = (active: boolean): KpiTone =>
    active ? "error" : "default";

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

  return (
    <Box>
      <PageHeader
        title={t("nav.dashboard")}
        subtitle={`${t("dashboard.period")}: ${formatDateTime(period.from)} — ${formatDateTime(period.to)}`}
      />

      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.salesToday")}
            value={formatCop(sales.confirmedTotal)}
            subtitle={t("dashboard.salesTodaySub", {
              count: sales.confirmedCount,
            })}
            icon={AttachMoneyIcon}
            tone="ok"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.averageTicket")}
            value={formatCop(sales.averageTicket)}
            subtitle={t("dashboard.averageTicketSub")}
            icon={ReceiptLongIcon}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.annulledToday")}
            value={formatCop(sales.annulledTotal)}
            subtitle={t("dashboard.annulledTodaySub", {
              count: sales.annulledCount,
            })}
            icon={CancelIcon}
            tone={tone(sales.annulledCount > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.openShifts")}
            value={formatNumber(cashShifts.openCount)}
            subtitle={t("dashboard.openShiftsSub")}
            icon={PaymentsIcon}
            tone="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.cashDifferences30d")}
            value={formatCop(cashShifts.differenceAmount30d)}
            subtitle={t("dashboard.cashDifferences30dSub", {
              count: cashShifts.differenceCount30d,
            })}
            icon={PaymentsIcon}
            tone={tone(cashShifts.differenceCount30d > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.pendingAdjustments")}
            value={formatNumber(inventory.pendingAdjustments)}
            subtitle={t("dashboard.pendingAdjustmentsSub")}
            icon={FactCheckIcon}
            tone={tone(inventory.pendingAdjustments > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.expiringLots")}
            value={formatNumber(inventory.expiringLots)}
            subtitle={t("dashboard.expiringLotsSub")}
            icon={EventBusyIcon}
            tone={tone(inventory.expiringLots > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.expiredLots")}
            value={formatNumber(inventory.expiredLots)}
            subtitle={t("dashboard.expiredLotsSub")}
            icon={LocalFireDepartmentIcon}
            tone={dangerTone(inventory.expiredLots > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.fiscalValidated")}
            value={formatNumber(fiscal.validated)}
            icon={VerifiedIcon}
            tone="ok"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.fiscalPending")}
            value={formatNumber(fiscal.pending)}
            icon={PendingActionsIcon}
            tone={tone(fiscal.pending > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.fiscalRejected")}
            value={formatNumber(fiscal.rejected)}
            icon={WarningAmberIcon}
            tone={dangerTone(fiscal.rejected > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.fiscalErrors")}
            value={formatNumber(fiscal.errors)}
            icon={WarningAmberIcon}
            tone={dangerTone(fiscal.errors > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.fiscalContingency")}
            value={formatNumber(fiscal.contingency)}
            icon={InventoryIcon}
            tone="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.syncFailures")}
            value={formatNumber(sync.permanentFailures)}
            subtitle={t("dashboard.syncFailuresSub")}
            icon={SyncProblemIcon}
            tone={dangerTone(sync.permanentFailures > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.pendingApprovals")}
            value={formatNumber(users.pendingApproval)}
            subtitle={t("dashboard.pendingApprovalsSub")}
            icon={HowToRegIcon}
            tone={tone(users.pendingApproval > 0)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg={3}>
          <KpiCard
            title={t("dashboard.activeSessions")}
            value={formatNumber(users.activeSessions)}
            subtitle={t("dashboard.activeSessionsSub")}
            icon={DevicesIcon}
            tone="info"
          />
        </Grid>
      </Grid>

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
