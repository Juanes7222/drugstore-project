import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import {
  fetchPlatformOverview,
  fetchSaasTrialsEnding,
} from "../../services/saas-admin";
import { formatCop, formatDate, formatNumber } from "../../utils/format";
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

const TRIALS_DAYS = 14;

function daysUntil(isoDate: string): number {
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

/** Trials converting soon — the outreach list for the owner. */
function TrialsEndingCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["saas-trials-ending", TRIALS_DAYS],
    queryFn: () => fetchSaasTrialsEnding(TRIALS_DAYS),
  });

  return (
    <Card variant="outlined" className="animate-fade-up" sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {t("saas.trials.title", { days: TRIALS_DAYS })}
        </Typography>
        {isLoading ? (
          <Typography variant="body2" color="text.secondary" py={2}>
            {t("common.loading")}
          </Typography>
        ) : !data || data.trials.length === 0 ? (
          <Typography variant="body2" color="text.secondary" py={2}>
            {t("saas.trials.empty")}
          </Typography>
        ) : (
          <List disablePadding>
            {data.trials.map((trial, index) => {
              const days = daysUntil(trial.trialEndsAt);
              return (
                <ListItem
                  key={trial.subscriptionId}
                  disablePadding
                  {...(index > 0 ? { divider: true } : {})}
                >
                  <ListItemButton
                    onClick={() =>
                      navigate(`/admin/customers/${trial.subscriptionId}`)
                    }
                    sx={{ px: 1, borderRadius: 1 }}
                  >
                    <ListItemText
                      primary={trial.customerName}
                      secondary={`${trial.plan.name} · ${trial.customerEmail ?? "—"}`}
                      primaryTypographyProps={{ fontWeight: 600 }}
                    />
                    <Box sx={{ textAlign: "right", flexShrink: 0, ml: 2 }}>
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        color={days <= 3 ? "warning.main" : "text.primary"}
                        sx={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {t("saas.trials.daysLeft", { count: days })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(trial.trialEndsAt)}
                      </Typography>
                    </Box>
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </CardContent>
    </Card>
  );
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

      {/* Outreach list: trials converting within the window. Mounts only on
          the success path, so its query does not fire for error states. */}
      <TrialsEndingCard />
    </Box>
  );
}
