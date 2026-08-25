import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import {
  fetchPlatformOverview,
} from "../../services/saas-admin";
import { formatCop, formatNumber } from "../../utils/format";
import type { KpiIconComponent } from "../../components/common/kpi-card";
import { KpiCard } from "../../components/common/kpi-card";
import { PageHeader } from "../../components/common/page-header";
import { LoadingState, ErrorState } from "../../components/common/states";
import {
  PeopleIcon,
  CheckCircleIcon,
  PendingActionsIcon,
  AttachMoneyIcon,
  DevicesIcon,
  DesktopWindowsIcon,
  WarningAmberIcon,
  CancelIcon,
} from "../../components/icons/app-icons";

interface KpiEntry {
  title: string;
  value: string;
  subtitle?: string;
  icon: KpiIconComponent;
  tone?: "default" | "ok" | "info" | "warning" | "error";
  live?: boolean;
}

/** Platform-wide metrics for the project owner. Read-only by design. */
export function PlatformOverviewPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-platform-overview"],
    queryFn: fetchPlatformOverview,
  });

  if (isLoading && !data) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const cards: KpiEntry[] = [
    {
      title: t("saas.kpi.customersTotal"),
      value: formatNumber(data.customers.total),
      icon: PeopleIcon,
    },
    {
      title: t("saas.kpi.customersActive"),
      value: formatNumber(data.customers.active),
      icon: CheckCircleIcon,
      tone: "ok",
    },
    {
      title: t("saas.kpi.customersTrial"),
      value: formatNumber(data.customers.trial),
      icon: PendingActionsIcon,
      tone: "info",
    },
    {
      title: t("saas.kpi.customersPastDue"),
      value: formatNumber(data.customers.pastDue),
      subtitle: `${t("saas.kpi.suspended")}: ${formatNumber(
        data.customers.suspended,
      )} · ${t("saas.kpi.canceled")}: ${formatNumber(data.customers.canceled)}`,
      icon: CancelIcon,
      tone: data.customers.pastDue > 0 ? "warning" : "default",
    },
    {
      title: t("saas.kpi.sales30d"),
      value: formatCop(data.sales30d.totalAmount),
      subtitle: t("saas.kpi.sales30dSub", {
        count: formatNumber(data.sales30d.count),
      }),
      icon: AttachMoneyIcon,
    },
    {
      title: t("saas.kpi.activeSessions"),
      value: formatNumber(data.activeSessions),
      subtitle: t("saas.kpi.activeSessionsSub"),
      icon: DevicesIcon,
      live: true,
    },
    {
      title: t("saas.kpi.workstations"),
      value: formatNumber(data.workstationCount),
      icon: DesktopWindowsIcon,
    },
    {
      title: t("saas.kpi.fraudAlerts"),
      value: formatNumber(data.openFraudAlerts),
      subtitle: t("saas.kpi.fraudAlertsSub"),
      icon: WarningAmberIcon,
      tone: data.openFraudAlerts > 0 ? "error" : "default",
    },
  ];

  return (
    <Box>
      <PageHeader
        title={t("saas.overviewTitle")}
        subtitle={t("saas.overviewSubtitle")}
      />
      <Grid container spacing={2}>
        {cards.map((card) => (
          <Grid item xs={12} sm={6} md={3} key={card.title}>
            <KpiCard
              title={card.title}
              value={card.value}
              subtitle={card.subtitle}
              icon={card.icon}
              tone={card.tone}
              live={card.live}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
