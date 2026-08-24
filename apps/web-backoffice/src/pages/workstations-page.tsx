import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { fetchWorkstations } from "../services/backoffice";
import { formatDateTime, formatNumber } from "../utils/format";
import type { WorkstationRow } from "../types/backoffice";
import { PageHeader } from "../components/common/page-header";
import { DataTable } from "../components/tables/data-table";
import { LoadingState, ErrorState } from "../components/common/states";

export function WorkstationsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["workstations"],
    queryFn: fetchWorkstations,
  });

  const columns = useMemo<ColumnDef<WorkstationRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("workstations.name"),
        accessorKey: "name",
        cell: (info) => (
          <Typography variant="body2" fontWeight={600}>
            {info.getValue<string>()}
          </Typography>
        ),
      },
      {
        id: "code",
        header: t("workstations.code"),
        accessorKey: "code",
        cell: (info) => info.getValue<string>(),
      },
      {
        id: "isActive",
        header: t("workstations.isActive"),
        accessorKey: "isActive",
        cell: (info) => {
          const active = info.getValue<boolean>();
          return (
            <Chip
              size="small"
              color={active ? "success" : "error"}
              variant="outlined"
              label={
                active ? t("workstations.online") : t("workstations.offline")
              }
            />
          );
        },
      },
      {
        id: "registeredAt",
        header: t("workstations.registeredAt"),
        accessorKey: "registeredAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "lastSeenAt",
        header: t("workstations.lastSeenAt"),
        accessorKey: "lastSeenAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
      {
        id: "activeSessions",
        header: t("workstations.activeSessions"),
        accessorKey: "activeSessions",
        meta: { align: "right" },
        cell: (info) => formatNumber(info.getValue<number>()),
      },
      {
        id: "salesToday",
        header: t("workstations.salesToday"),
        accessorKey: "salesToday",
        meta: { align: "right" },
        cell: (info) => formatNumber(info.getValue<number>()),
      },
    ],
    [t],
  );

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <Box>
      <PageHeader
        title={t("workstations.title")}
        subtitle={t("workstations.subtitle")}
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {t("workstations.activeSessionCount")}:{" "}
          <Typography
            component="span"
            variant="subtitle1"
            fontWeight={700}
            color="primary"
          >
            {data.activeSessionCount}
          </Typography>
        </Typography>
      </Paper>

      <DataTable
        columns={columns}
        data={data.workstations}
        total={data.workstations.length}
        page={1}
        pageSize={data.workstations.length || 1}
        totalPages={1}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
      />
    </Box>
  );
}
