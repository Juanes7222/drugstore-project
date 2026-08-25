import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { fetchSaasSyncHealth } from "../../services/saas-admin";
import type { SaasAdminSyncHealthRow } from "../../types/saas-admin";
import { formatDateTime, formatNumber } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { LoadingState, ErrorState } from "../../components/common/states";

/** Cross-tenant terminal sync health, worst offenders first. */
export function SyncHealthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-sync-health"],
    queryFn: fetchSaasSyncHealth,
  });

  const columns = useMemo<ColumnDef<SaasAdminSyncHealthRow, unknown>[]>(
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
            onClick={() => navigate(`/admin/customers/${info.row.original.subscriptionId}`)}
          >
            {info.getValue<string>()}
          </Button>
        ),
      },
      {
        id: "pendingOperations",
        header: t("saas.sync.pending"),
        meta: { align: "right" },
        accessorKey: "pendingOperations",
        cell: (info) => {
          const value = info.getValue<number>();
          return (
            <Typography
              variant="body2"
              color={value > 0 ? "warning.main" : undefined}
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatNumber(value)}
            </Typography>
          );
        },
      },
      {
        id: "permanentFailures",
        header: t("saas.sync.failures"),
        meta: { align: "right" },
        accessorKey: "permanentFailures",
        cell: (info) => {
          const value = info.getValue<number>();
          return (
            <Typography
              variant="body2"
              fontWeight={value > 0 ? 700 : 400}
              color={value > 0 ? "error.main" : undefined}
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatNumber(value)}
            </Typography>
          );
        },
      },
      {
        id: "oldestPendingAt",
        header: t("saas.sync.oldestPending"),
        accessorKey: "oldestPendingAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
      {
        id: "lastSyncAt",
        header: t("saas.sync.lastSync"),
        accessorKey: "lastSyncAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
    ],
    [t, navigate],
  );

  return (
    <Box>
      <PageHeader
        title={t("saas.sync.title")}
        subtitle={t("saas.sync.subtitle")}
      />

      {isLoading && !data ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : data ? (
        <DataTable
          columns={columns}
          data={data}
          total={data.length}
          page={1}
          pageSize={Math.max(data.length, 1)}
          totalPages={1}
          onPageChange={() => undefined}
          getRowId={(row) => row.subscriptionId}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage={t("saas.sync.empty")}
          ariaLabel={t("saas.sync.title")}
        />
      ) : null}
    </Box>
  );
}
