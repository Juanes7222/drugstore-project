import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { fetchSaasAtRisk } from "../../services/saas-admin";
import type { SaasAdminAtRiskRow } from "../../types/saas-admin";
import { formatDate } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { ExportButton } from "../../components/common/export-button";
import { DataTable } from "../../components/tables/data-table";
import { StatusChip } from "../../components/common/status-chip";
import { LoadingState, ErrorState } from "../../components/common/states";

/** Churn-signal list: active customers that stopped selling. */
export function AtRiskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Window choices map to the server's validated 7..90 range.
  const [inactiveDays, setInactiveDays] = useState("14");

  const days = Number(inactiveDays);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-at-risk", inactiveDays],
    queryFn: () => fetchSaasAtRisk(days),
    enabled: Number.isInteger(days) && days >= 7 && days <= 90,
  });

  const columns = useMemo<ColumnDef<SaasAdminAtRiskRow, unknown>[]>(
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
        id: "email",
        header: t("saas.columns.email"),
        accessorKey: "customerEmail",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "status",
        header: t("saas.columns.status"),
        accessorKey: "status",
        cell: (info) => <StatusChip value={info.getValue<string>()} kind="subscription" />,
      },
      {
        id: "lastSaleAt",
        header: t("saas.atRisk.lastSale"),
        accessorKey: "lastSaleAt",
        cell: (info) => {
          const value = info.getValue<string | null>();
          return value ? (
            formatDate(value)
          ) : (
            <Typography variant="body2" color="warning.main">
              {t("saas.atRisk.neverSold")}
            </Typography>
          );
        },
      },
      {
        id: "activations",
        header: t("saas.columns.activations"),
        accessorKey: "workstationActivations",
        meta: { align: "right" },
      },
    ],
    [t, navigate],
  );

  return (
    <Box>
      <PageHeader
        title={t("saas.atRisk.title")}
        subtitle={t("saas.atRisk.subtitle")}
        actions={
          <>
            <ExportButton
              path="/saas-admin/at-risk/export"
              params={{ inactiveDays: days }}
              fallbackName="saas-at-risk"
            />
            <TextField
              size="small"
              select
              label={t("saas.atRisk.window")}
              value={inactiveDays}
              onChange={(event) => setInactiveDays(event.target.value)}
              sx={{ width: 220 }}
            >
              {["7", "14", "30", "60", "90"].map((value) => (
                <MenuItem key={value} value={value}>
                  {t("saas.atRisk.windowOption", { count: Number(value) })}
                </MenuItem>
              ))}
            </TextField>
          </>
        }
      />

      {isLoading || !Number.isInteger(days) ? (
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
          emptyMessage={t("saas.atRisk.empty")}
          ariaLabel={t("saas.atRisk.title")}
        />
      ) : null}
    </Box>
  );
}
