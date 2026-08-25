import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { fetchSaasAccessAudit } from "../../services/saas-admin";
import type { SaasAdminAccessAuditRow } from "../../types/saas-admin";
import { formatDateTime } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { LoadingState, ErrorState } from "../../components/common/states";

const PAGE_SIZE = 20;

/**
 * Global trail of the platform owner's cross-tenant reads. Every
 * /saas-admin customer access is recorded server-side; this page is its
 * only reader.
 */
export function PlatformAuditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-access-audit", page],
    queryFn: () => fetchSaasAccessAudit(page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<ColumnDef<SaasAdminAccessAuditRow, unknown>[]>(
    () => [
      {
        id: "createdAt",
        header: t("audit.createdAt"),
        accessorKey: "createdAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "actorEmail",
        header: t("saas.audit.actor"),
        accessorKey: "actorEmail",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "action",
        header: t("audit.action"),
        accessorKey: "action",
      },
      {
        id: "customerName",
        header: t("saas.columns.customer"),
        accessorKey: "customerName",
        cell: (info) => {
          const row = info.row.original;
          return row.subscriptionId ? (
            <Button
              variant="text"
              size="small"
              sx={{ px: 0, textTransform: "none", justifyContent: "flex-start" }}
              onClick={() => navigate(`/admin/customers/${row.subscriptionId}`)}
            >
              {row.customerName ?? t("saas.audit.viewCustomer")}
            </Button>
          ) : (
            (info.getValue<string | null>() ?? "—")
          );
        },
      },
      {
        id: "summary",
        header: t("audit.entityId"),
        accessorKey: "summary",
        cell: (info) => (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {info.getValue<string | null>() ?? "—"}
          </Typography>
        ),
      },
      {
        id: "ipAddress",
        header: t("audit.ip"),
        accessorKey: "ipAddress",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
    ],
    [t, navigate],
  );

  return (
    <Box>
      <PageHeader
        title={t("saas.audit.title")}
        subtitle={t("saas.audit.subtitle")}
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
          emptyMessage={t("common.empty")}
          ariaLabel={t("saas.audit.title")}
        />
      ) : null}
    </Box>
  );
}
