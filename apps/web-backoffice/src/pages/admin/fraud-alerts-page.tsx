import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  fetchSaasFraudAlerts,
  resolveSaasFraudAlert,
  type FraudAlertsFilter,
} from "../../services/saas-admin";
import type {
  SaasAdminFraudAlertRow,
} from "../../types/saas-admin";
import { formatDateTime } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { ConfirmDialog } from "../../components/common/confirm-dialog";
import { LoadingState, ErrorState } from "../../components/common/states";

const PAGE_SIZE = 20;

/** Every fraud state the server model knows, for the manual filter. */
const STATUS_FILTERS = [
  "ALL",
  "OPEN",
  "INVESTIGATING",
  "DISMISSED",
  "CONFIRMED_FRAUD",
] as const;

function severityColor(severity: string): "error" | "warning" | "default" {
  if (severity === "HIGH") return "error";
  if (severity === "MEDIUM") return "warning";
  return "default";
}

export function FraudAlertsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<FraudAlertsFilter>("");
  const [pendingResolve, setPendingResolve] =
    useState<SaasAdminFraudAlertRow | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-fraud-alerts", page, status],
    queryFn: () => fetchSaasFraudAlerts(page, PAGE_SIZE, status),
    placeholderData: (previous) => previous,
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      resolveSaasFraudAlert({ alertId: pendingResolve?.id ?? "" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saas-fraud-alerts"] });
      // The overview KPI counts open alerts too.
      void queryClient.invalidateQueries({
        queryKey: ["saas-platform-overview"],
      });
      setPendingResolve(null);
    },
  });

  const columns = useMemo<ColumnDef<SaasAdminFraudAlertRow, unknown>[]>(
    () => [
      {
        id: "customer",
        header: t("saas.columns.customer"),
        accessorKey: "customerName",
        cell: (info) => (
          <Button
            variant="text"
            size="small"
            sx={{ px: 0, textTransform: "none", fontWeight: 600, justifyContent: "flex-start" }}
            onClick={() =>
              navigate(`/admin/customers/${info.row.original.subscriptionId}`)
            }
          >
            {info.getValue<string>()}
          </Button>
        ),
      },
      {
        id: "severity",
        header: t("saas.fraud.severity"),
        accessorKey: "severity",
        cell: (info) => (
          <Chip
            size="small"
            variant="outlined"
            color={severityColor(info.getValue<string>())}
            label={t(`saas.fraud.severity_${info.getValue<string>()}`, {
              defaultValue: info.getValue<string>(),
            })}
          />
        ),
      },
      {
        id: "description",
        header: t("saas.fraud.description"),
        accessorKey: "description",
        cell: (info) => (
          <Typography
            variant="body2"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {info.getValue<string>()}
          </Typography>
        ),
      },
      {
        id: "type",
        header: t("saas.fraud.detector"),
        accessorKey: "type",
        cell: (info) => (
          <Typography variant="caption" color="text.secondary">
            {info.getValue<string>().replace(/Detector$/, "")}
          </Typography>
        ),
      },
      {
        id: "detectedAt",
        header: t("saas.fraud.detectedAt"),
        accessorKey: "detectedAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "resolution",
        header: t("saas.fraud.resolution"),
        accessorFn: (row) => row.resolvedAt ?? "",
        cell: (info) => {
          const row = info.row.original;
          return row.resolvedAt ? (
            <Typography variant="caption" color="text.secondary">
              {t("saas.fraud.resolvedBy", { email: row.resolvedByAdminEmail ?? "—" })}
              <br />
              {formatDateTime(row.resolvedAt)}
            </Typography>
          ) : (
            <Button
              size="small"
              variant="outlined"
              onClick={() => setPendingResolve(row)}
            >
              {t("saas.fraud.resolve")}
            </Button>
          );
        },
      },
    ],
    [t, navigate],
  );

  return (
    <Box>
      <PageHeader
        title={t("saas.fraud.title")}
        subtitle={t("saas.fraud.subtitle")}
        actions={
          <TextField
            size="small"
            select
            label={t("saas.fraud.statusFilter")}
            value={status}
            onChange={(event) => setStatus(event.target.value as FraudAlertsFilter)}
            sx={{ width: 220 }}
          >
            <MenuItem value="">{t("saas.fraud.queueOpen")}</MenuItem>
            {STATUS_FILTERS.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`saas.fraud.status_${value}`)}
              </MenuItem>
            ))}
          </TextField>
        }
      />

      {isLoading && !data ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : data ? (
        <DataTable
          columns={columns}
          data={data.data}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          totalPages={data.totalPages}
          onPageChange={setPage}
          getRowId={(row) => row.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          ariaLabel={t("saas.fraud.title")}
        />
      ) : null}

      <ConfirmDialog
        open={pendingResolve !== null}
        title={t("saas.fraud.confirmTitle")}
        message={t("saas.fraud.confirmMessage", {
          customer: pendingResolve?.customerName ?? "",
        })}
        confirmLabel={t("saas.fraud.resolve")}
        severity="warning"
        onConfirm={() => resolveMutation.mutateAsync()}
        onClose={() => setPendingResolve(null)}
      />
    </Box>
  );
}
