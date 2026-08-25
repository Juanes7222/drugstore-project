import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import type { SaasAdminPlatformAdminRow } from "../../types/saas-admin";
import { fetchSaasPlatformAdmins } from "../../services/saas-admin";
import { formatDate, formatDateTime } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { StatusChip } from "../../components/common/status-chip";
import { LoadingState, ErrorState } from "../../components/common/states";

/**
 * Read-only visibility over which accounts hold the platform-admin flag.
 * Granting/revoking stays script-only on purpose: no HTTP endpoint may
 * write the flag.
 */
export function AdminsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-platform-admins"],
    queryFn: fetchSaasPlatformAdmins,
  });

  const columns = useMemo<ColumnDef<SaasAdminPlatformAdminRow, unknown>[]>(
    () => [
      {
        id: "email",
        header: t("saas.columns.email"),
        accessorKey: "email",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "fullName",
        header: t("users.name"),
        accessorKey: "fullName",
      },
      {
        id: "role",
        header: t("users.role"),
        accessorKey: "role",
      },
      {
        id: "status",
        header: t("saas.columns.status"),
        accessorKey: "status",
        cell: (info) => <StatusChip value={info.getValue<string>()} kind="user" />,
      },
      {
        id: "lastLoginAt",
        header: t("users.lastLogin"),
        accessorKey: "lastLoginAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
      {
        id: "createdAt",
        header: t("users.createdAt"),
        accessorKey: "createdAt",
        cell: (info) => formatDate(info.getValue<string>()),
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader title={t("saas.admins.title")} subtitle={t("saas.admins.subtitle")} />

      <Alert severity="info" sx={{ mb: 2 }}>
        {t("saas.admins.scriptOnly")}
      </Alert>

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
          getRowId={(row) => row.userId}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage={t("common.empty")}
          ariaLabel={t("saas.admins.title")}
        />
      ) : null}
    </Box>
  );
}
